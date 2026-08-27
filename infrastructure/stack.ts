import { Stack } from '@atombrenner/cfn-stack'
import * as fs from 'fs'

function requiredEnvironment(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

async function main() {
  const region = requiredEnvironment('AWS_REGION')
  const stackName = requiredEnvironment('LAMBDA_STACK_NAME')
  const params = {
    SomeParameter: requiredEnvironment('SOME_PARAMETER'),
    LambdaFunctionName: requiredEnvironment('LAMBDA_FUNCTION_NAME'),
    TextureApiKey: requiredEnvironment('TEXTURE_API_KEY'),
    EthereumProvider: requiredEnvironment('ETHEREUM_PROVIDER'),
    DaylightSigningKey: requiredEnvironment('DAYLIGHT_SIGNING_KEY'),
    DaylightDeviceContractAddress: requiredEnvironment('DAYLIGHT_DEVICE_CONTRACT_ADDRESS'),
  }
  const template = fs.readFileSync(new URL('./cloudformation.yaml', import.meta.url), {
    encoding: 'utf-8',
  })
  const stack = new Stack({ name: stackName, region })

  await stack.createOrUpdate(template, params)

  const outputs: Record<string, string> = await stack.getOutputs()
  console.log(`LambdaUrl: ${outputs.LambdaUrl}`)
}

main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'UnknownError'
  const message = error instanceof Error ? error.message : 'Unknown stack deployment error'
  console.error(name, message)
  process.exit(1)
})
