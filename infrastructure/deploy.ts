import { LambdaClient, UpdateFunctionCodeCommand } from '@aws-sdk/client-lambda'
import { readFileSync } from 'fs'

function requiredEnvironment(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

async function main() {
  const region = requiredEnvironment('AWS_REGION')
  const functionName = requiredEnvironment('LAMBDA_FUNCTION_NAME')
  const lambda = new LambdaClient({ region })
  const artifact = new URL('../dist/lambda.zip', import.meta.url)
  const zipFile = readFileSync(artifact)

  const result = await lambda.send(
    new UpdateFunctionCodeCommand({ FunctionName: functionName, ZipFile: zipFile })
  )

  console.log('Updated Lambda function code', {
    functionName: result.FunctionName,
    version: result.Version,
  })
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown deployment error'
  console.error(message)
  process.exit(1)
})
