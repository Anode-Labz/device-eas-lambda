import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda'
import { ethers } from 'ethers'

type LambdaFunctionUrlEvent = APIGatewayProxyEventV2
type LambdaFunctionUrlResult = APIGatewayProxyResultV2

export type DeviceMintRequest = {
  deviceId: string
  userAddress: string
  signature: string
}

export type TextureDevice = {
  manufacturerDeviceId: string
  deviceType: string
  manufacturer: string
}

const textureApiUrl = 'https://api.texturehq.com/v1/devices'
const daylightDeviceContractAbi = ['function mintDevice(bytes data) public returns (uint256)']

class InvalidRequestError extends Error {}

class UpstreamServiceError extends Error {}

class ConfigurationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function deviceMintMessage(deviceId: string): string {
  return `Dawn of Daylight device mint\nDevice ID: ${deviceId}`
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new ConfigurationError(`Missing required environment variable: ${name}`)
  }

  return value
}

function jsonResponse(statusCode: number, body: Record<string, unknown>): LambdaFunctionUrlResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export function parseDeviceRequest(
  body: string | undefined,
  isBase64Encoded = false
): DeviceMintRequest {
  if (!body) {
    throw new InvalidRequestError('The request body is required')
  }

  const decodedBody = isBase64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body
  let parsedBody: unknown

  try {
    parsedBody = JSON.parse(decodedBody)
  } catch {
    throw new InvalidRequestError('The request body must be valid JSON')
  }

  if (!isRecord(parsedBody)) {
    throw new InvalidRequestError('The request body must be a JSON object')
  }

  const { deviceId, userAddress, signature } = parsedBody

  if (
    typeof deviceId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(deviceId) ||
    typeof userAddress !== 'string' ||
    !ethers.isAddress(userAddress) ||
    typeof signature !== 'string' ||
    !ethers.isHexString(signature, 65)
  ) {
    throw new InvalidRequestError('The request contains an invalid device ID, user address, or signature')
  }

  const normalizedUserAddress = ethers.getAddress(userAddress)

  try {
    if (ethers.getAddress(ethers.verifyMessage(deviceMintMessage(deviceId), signature)) !== normalizedUserAddress) {
      throw new InvalidRequestError('The signature does not match the requested user address')
    }
  } catch (error) {
    if (error instanceof InvalidRequestError) {
      throw error
    }

    throw new InvalidRequestError('The signature is invalid')
  }

  return {
    deviceId,
    userAddress: normalizedUserAddress,
    signature,
  }
}

export function parseTextureDevice(payload: unknown): TextureDevice {
  if (!isRecord(payload)) {
    throw new UpstreamServiceError('Texture returned an invalid device payload')
  }

  const { manufacturerDeviceId, deviceType, manufacturer } = payload

  if (
    typeof manufacturerDeviceId !== 'string' ||
    manufacturerDeviceId.length === 0 ||
    typeof deviceType !== 'string' ||
    deviceType.length === 0 ||
    typeof manufacturer !== 'string' ||
    manufacturer.length === 0
  ) {
    throw new UpstreamServiceError('Texture returned incomplete device data')
  }

  return { manufacturerDeviceId, deviceType, manufacturer }
}

export function encodeMintData(request: DeviceMintRequest, device: TextureDevice): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'bytes32', 'bytes32', 'bytes32'],
    [
      request.userAddress,
      ethers.id(device.manufacturerDeviceId),
      ethers.id(device.deviceType),
      ethers.id(device.manufacturer),
    ]
  )
}

export async function handler(
  event: LambdaFunctionUrlEvent,
  context: Context
): Promise<LambdaFunctionUrlResult> {
  if (event.requestContext.http.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  console.log('Processing device mint request', {
    functionName: context.functionName,
    requestId: context.awsRequestId,
    method: event.requestContext.http.method,
    path: event.rawPath,
  })

  let request: DeviceMintRequest

  try {
    request = parseDeviceRequest(event.body, event.isBase64Encoded)
  } catch (error) {
    console.warn('Rejected invalid device mint request', {
      requestId: context.awsRequestId,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    })
    return jsonResponse(400, { error: 'Invalid request' })
  }

  try {
    const textureApiKey = requiredEnvironment('TEXTURE_API_KEY')
    const ethereumProvider = requiredEnvironment('ETHEREUM_PROVIDER')
    const daylightSigningKey = requiredEnvironment('DAYLIGHT_SIGNING_KEY')
    const contractAddress = requiredEnvironment('DAYLIGHT_DEVICE_CONTRACT_ADDRESS')

    if (!ethers.isAddress(contractAddress)) {
      throw new ConfigurationError('DAYLIGHT_DEVICE_CONTRACT_ADDRESS must be a valid address')
    }

    let textureResponse: Response

    try {
      textureResponse = await fetch(`${textureApiUrl}/${encodeURIComponent(request.deviceId)}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Texture-Api-Key': textureApiKey,
        },
        signal: AbortSignal.timeout(5000),
      })
    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        throw new UpstreamServiceError('Texture request timed out')
      }

      throw error
    }

    if (!textureResponse.ok) {
      throw new UpstreamServiceError(`Texture returned HTTP ${textureResponse.status}`)
    }

    let texturePayload: unknown

    try {
      texturePayload = await textureResponse.json()
    } catch {
      throw new UpstreamServiceError('Texture returned invalid JSON')
    }

    const device = parseTextureDevice(texturePayload)
    const provider = new ethers.InfuraProvider(ethereumProvider)
    const signer = new ethers.Wallet(daylightSigningKey, provider)
    const contract = new ethers.Contract(contractAddress, daylightDeviceContractAbi, signer)
    const transaction = await contract.mintDevice(encodeMintData(request, device))
    const receipt = await transaction.wait()

    if (!receipt) {
      throw new Error('The device mint transaction did not produce a receipt')
    }

    return jsonResponse(200, { transactionHash: receipt.hash })
  } catch (error) {
    const errorType = error instanceof Error ? error.name : 'UnknownError'
    console.error('Device mint request failed', {
      requestId: context.awsRequestId,
      errorType,
    })

    if (error instanceof ConfigurationError) {
      return jsonResponse(500, { error: 'The service is not configured correctly' })
    }

    if (error instanceof UpstreamServiceError) {
      return jsonResponse(502, { error: 'The device service is unavailable' })
    }

    return jsonResponse(500, { error: 'The device mint could not be completed' })
  }
}
