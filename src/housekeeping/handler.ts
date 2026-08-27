import { S3Client } from '@aws-sdk/client-s3'
import { ScheduledEvent } from 'aws-lambda'
import { housekeeping } from './housekeeping'

function requiredEnvironment(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

const bucket = requiredEnvironment('BUCKET')
const s3 = new S3Client({ region: requiredEnvironment('AWS_REGION') })

export async function handler(event: ScheduledEvent): Promise<void> {
  console.log('Housekeeping started', {
    eventId: event.id,
    source: event.source,
    time: event.time,
    bucket,
  })
  await housekeeping(s3, bucket)
  console.log('Housekeeping finished', { bucket })
}
