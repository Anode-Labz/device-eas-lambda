import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda'
// import { EAS, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk'
import { ethers } from 'ethers'

// AWS Lambda Function Urls are reusing types from APIGateway
// but many fields are not used or filled with default values
// see: https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html
// It would be nice to have types with only the used fields and add them to:
// https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/aws-lambda
type LambdaFunctionUrlEvent = APIGatewayProxyEventV2
type LambdaFunctionUrlResult = APIGatewayProxyResultV2

// Note: think of enhancing logging with structure (JSON) and metrics
// - @atombrenner/log-json: https://github.com/atombrenner/npm-log-json
// - pino: https://github.com/pinojs/pino
// - https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html
// - @aws-lambda-powertools/metrics: https://docs.powertools.aws.dev/lambda/typescript/latest/core/metrics/#getting-started

// TODO: ENV VARIABLES
const TEXTURE_API_KEY = process.env.TEXTURE_API_KEY || '<your-api-key-goes-here>'
const ETHEREUM_PROVIDER = process.env.ETHEREUM_PROVIDER || 'url'
const DAYLIGHT_SIGNING_KEY = process.env.DAYLIGHT_SIGNING_KEY || 'key'

export async function handler(
  event: LambdaFunctionUrlEvent,
  context: Context
): Promise<LambdaFunctionUrlResult> {
  console.log(context.functionName)
  console.log(`${event.requestContext.http.method} ${event.rawPath}`)

  // inputs: accountAddress, deviceId

  let body = JSON.parse(event.body!)

  // texture GET device by device_id
  const deviceId = body.deviceId
  const textureApiUrl = `https://api.texturehq.com/v1/devices`

  // Node v18 has fetch built in
  let response = await fetch(`${textureApiUrl}/${deviceId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Texture-Api-Key': TEXTURE_API_KEY,
    },
  })

  let deviceJson: any = await response.json()

  // check if device and account pair is valid (same location as other devices, etc...)

  // load ethereum signer and provider
  // Second parameter is chainId, 1 for Ethereum mainnet
  const provider = new ethers.InfuraProvider(ETHEREUM_PROVIDER)
  const signer = new ethers.Wallet(DAYLIGHT_SIGNING_KEY, provider)

  const daylightDeviceContractAddress = ''
  const daylightDeviceContractAbi = ['function mintDevice(bytes data) public returns (uint256)']

  const daylightDeviceContract: any = new ethers.Contract(
    daylightDeviceContractAddress,
    daylightDeviceContractAbi,
    signer
  )

  let mintData = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'bytes32', 'bytes32', 'bytes32'],
    [
      body.userAddress,
      ethers.hashMessage(deviceJson.manufacturerDeviceId),
      deviceJson.deviceType,
      deviceJson.manufacturer,
    ]
  )
  let tx = await daylightDeviceContract.mintDevice(mintData)
  let submittedTx = await tx.wait()

  // make EAS attestation of device ownership
  // const EASContractAddress = '0xC2679fBD37d54388Ce493F1DB75320D236e1815e' // sepolia v0
  // const eas = new EAS(EASContractAddress)
  // eas.connect(signer)

  // // TODO: write schema
  // const schemaEncoder = new SchemaEncoder('uint256 eventId, uint8 voteIndex')
  // const encodedData = schemaEncoder.encodeData([
  //   { name: 'eventId', value: 1, type: 'uint256' },
  //   { name: 'voteIndex', value: 1, type: 'uint8' },
  // ])

  // const schemaUID = '0xb16fa048b0d597f5a821747eba64efa4762ee5143e9a80600d0005386edfc995'

  // const transaction = await eas.attest({
  //   schema: schemaUID,
  //   data: {
  //     recipient: '0xFD50b031E778fAb33DfD2Fc3Ca66a1EeF0652165',
  //     expirationTime: 0,
  //     revocable: false, // Be aware that if your schema is not revocable, this MUST be false
  //     data: encodedData,
  //   },
  // })

  // const newAttestationUID = await transaction.wait()

  // load ethereum provider and signer

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      {
        // attestationUid: newAttestationUID,
        transaction: submittedTx.toJSON(),
      },
      null,
      2
    ),
  }
}
