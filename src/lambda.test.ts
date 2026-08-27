import { ethers } from 'ethers'
import { deviceMintMessage, encodeMintData, parseDeviceRequest } from './lambda'

const wallet = new ethers.Wallet(`0x${'11'.repeat(32)}`)

describe('device mint request validation', () => {
  it('rejects missing and malformed request bodies', () => {
    expect(() => parseDeviceRequest(undefined)).toThrow('The request body is required')
    expect(() => parseDeviceRequest('{')).toThrow('The request body must be valid JSON')
    expect(() =>
      parseDeviceRequest(
        JSON.stringify({
          deviceId: '../secret',
          userAddress: ethers.ZeroAddress,
          signature: '0x00',
        })
      )
    ).toThrow('The request contains an invalid device ID, user address, or signature')
  })

  it('normalizes valid addresses and accepts base64-encoded signed JSON', async () => {
    const deviceId = 'device_01'
    const signature = await wallet.signMessage(deviceMintMessage(deviceId))
    const request = parseDeviceRequest(
      Buffer.from(
        JSON.stringify({
          deviceId,
          userAddress: wallet.address,
          signature,
        })
      ).toString('base64'),
      true
    )

    expect(request).toEqual({ deviceId, userAddress: wallet.address, signature })
  })
})

describe('mint data encoding', () => {
  it('encodes textual device attributes as bytes32 hashes', async () => {
    const deviceId = 'device_01'
    const signature = await wallet.signMessage(deviceMintMessage(deviceId))
    const encoded = encodeMintData(
      { deviceId, userAddress: wallet.address, signature },
      {
        manufacturerDeviceId: 'manufacturer-123',
        deviceType: 'sensor',
        manufacturer: 'Texture',
      }
    )

    const [userAddress, manufacturerDeviceId, deviceType, manufacturer] = ethers.AbiCoder.defaultAbiCoder().decode(
      ['address', 'bytes32', 'bytes32', 'bytes32'],
      encoded
    )

    expect(userAddress).toBe(wallet.address)
    expect(manufacturerDeviceId).toBe(ethers.id('manufacturer-123'))
    expect(deviceType).toBe(ethers.id('sensor'))
    expect(manufacturer).toBe(ethers.id('Texture'))
  })
})
