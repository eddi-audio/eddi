#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { EddiStack } from '../lib/eddi-stack'

const app = new cdk.App()

new EddiStack(app, 'EddiStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: 'Eddi card page backend — API Gateway, Lambda, DynamoDB, S3',
})
