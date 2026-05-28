import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as events from 'aws-cdk-lib/aws-events'
import * as targets from 'aws-cdk-lib/aws-events-targets'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import * as path from 'path'
import { Construct } from 'constructs'

export class EddiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // ── DynamoDB Tables ──────────────────────────────────────────────────────

    const cardsTable = new dynamodb.Table(this, 'CardsTable', {
      tableName: 'eddi-cards',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    })

    const cardEventsTable = new dynamodb.Table(this, 'CardEventsTable', {
      tableName: 'eddi-card-events',
      partitionKey: { name: 'card_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'ts_event_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
    })

    // Seeded empty — resolver sprint will write to this
    new dynamodb.Table(this, 'IsrcCacheTable', {
      tableName: 'eddi-isrc-cache',
      partitionKey: { name: 'isrc', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
    })

    // ── S3 Buckets ────────────────────────────────────────────────────────────

    const artworkBucket = new s3.Bucket(this, 'ArtworkBucket', {
      bucketName: `eddi-artwork-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedOrigins: ['https://eddi.audio', 'http://localhost:5173'],
          allowedMethods: [s3.HttpMethods.GET],
          allowedHeaders: ['*'],
          maxAge: 86400,
        },
      ],
    })

    const ogImageBucket = new s3.Bucket(this, 'OgImageBucket', {
      bucketName: `eddi-og-images-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    // ── Lambda Layer (Sharp — pre-compiled ARM64) ────────────────────────────

    const sharpLayer = new lambda.LayerVersion(this, 'SharpLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../layers/sharp'), {
        bundling: {
          image: lambda.Runtime.NODEJS_20_X.bundlingImage,
          platform: 'linux/arm64',
          command: [
            'bash', '-c',
            [
              'npm ci --omit=dev',
              'mkdir -p /asset-output/nodejs',
              'cp -r node_modules /asset-output/nodejs/',
            ].join(' && '),
          ],
          environment: {
            npm_config_arch: 'arm64',
            npm_config_platform: 'linux',
            npm_config_libc: 'glibc',
          },
        },
      }),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      compatibleArchitectures: [lambda.Architecture.ARM_64],
      description: 'Sharp image processing — linux/arm64',
    })

    // ── Shared Lambda config ─────────────────────────────────────────────────

    const commonEnv = {
      CARDS_TABLE: cardsTable.tableName,
      CARD_EVENTS_TABLE: cardEventsTable.tableName,
      ARTWORK_BUCKET: artworkBucket.bucketName,
      OG_IMAGE_BUCKET: ogImageBucket.bucketName,
    }

    const sharedBundling = {
      minify: true,
      sourceMap: true,
      target: 'node20',
      externalModules: ['sharp', '@aws-sdk/*'],
    }

    const nodejsDefaults = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
    } satisfies Partial<NodejsFunctionProps>

    // ── Lambda Functions ─────────────────────────────────────────────────────

    const cardLookupFn = new NodejsFunction(this, 'CardLookupFn', {
      ...nodejsDefaults,
      functionName: 'eddi-card-lookup',
      entry: path.join(__dirname, '../lambda/card-lookup/index.ts'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      bundling: sharedBundling,
      environment: commonEnv,
    })

    const eventLogFn = new NodejsFunction(this, 'EventLogFn', {
      ...nodejsDefaults,
      functionName: 'eddi-event-log',
      entry: path.join(__dirname, '../lambda/event-log/index.ts'),
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      bundling: sharedBundling,
      environment: commonEnv,
    })

    const cardWriteFn = new NodejsFunction(this, 'CardWriteFn', {
      ...nodejsDefaults,
      functionName: 'eddi-card-write',
      entry: path.join(__dirname, '../lambda/card-write/index.ts'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      layers: [sharpLayer],
      bundling: sharedBundling,
      environment: {
        ...commonEnv,
        SPOTIFY_CLIENT_ID_PARAM: '/eddi/prod/spotify/client_id',
        SPOTIFY_CLIENT_SECRET_PARAM: '/eddi/prod/spotify/client_secret',
      },
    })

    const ogImageFn = new NodejsFunction(this, 'OgImageFn', {
      ...nodejsDefaults,
      functionName: 'eddi-og-image',
      entry: path.join(__dirname, '../lambda/og-image/index.ts'),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      layers: [sharpLayer],
      bundling: sharedBundling,
      environment: commonEnv,
    })

    // ── IAM Permissions ──────────────────────────────────────────────────────

    cardsTable.grantReadWriteData(cardLookupFn)
    cardEventsTable.grantWriteData(cardLookupFn)

    cardEventsTable.grantWriteData(eventLogFn)

    cardsTable.grantReadWriteData(cardWriteFn)
    artworkBucket.grantReadWrite(cardWriteFn)
    ssm.StringParameter.fromSecureStringParameterAttributes(this, 'SpotifyClientId', {
      parameterName: '/eddi/prod/spotify/client_id',
    }).grantRead(cardWriteFn)
    ssm.StringParameter.fromSecureStringParameterAttributes(this, 'SpotifyClientSecret', {
      parameterName: '/eddi/prod/spotify/client_secret',
    }).grantRead(cardWriteFn)

    cardsTable.grantReadData(ogImageFn)
    artworkBucket.grantRead(ogImageFn)
    ogImageBucket.grantReadWrite(ogImageFn)

    // ── API Gateway ──────────────────────────────────────────────────────────

    const api = new apigateway.RestApi(this, 'EddiApi', {
      restApiName: 'eddi-api',
      description: 'Eddi card page API',
      defaultCorsPreflightOptions: {
        allowOrigins: ['https://eddi.audio', 'http://localhost:5173'],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
        maxAge: cdk.Duration.hours(24),
      },
      deployOptions: {
        stageName: 'prod',
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      },
    })

    const cardsResource = api.root.addResource('cards')
    const cardResource = cardsResource.addResource('{id}')
    cardResource.addMethod('GET', new apigateway.LambdaIntegration(cardLookupFn))
    cardResource.addResource('events').addMethod('POST', new apigateway.LambdaIntegration(eventLogFn))

    api.root.addResource('resolve').addMethod('POST', new apigateway.LambdaIntegration(cardWriteFn))
    cardsResource.addMethod('POST', new apigateway.LambdaIntegration(cardWriteFn))
    api.root.addResource('og').addResource('{id}').addMethod('GET', new apigateway.LambdaIntegration(ogImageFn))

    // ── Keep-alive ────────────────────────────────────────────────────────────

    const keepAlive = new events.Rule(this, 'KeepAlive', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      description: 'Keep eddi-card-lookup warm',
    })
    keepAlive.addTarget(new targets.LambdaFunction(cardLookupFn, {
      event: events.RuleTargetInput.fromObject({ source: 'keep-alive' }),
    }))

    // ── Outputs ───────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Set as VITE_API_URL in Cloudflare Pages env vars and API_URL in Pages Function env vars',
    })
    new cdk.CfnOutput(this, 'ArtworkBucket', { value: artworkBucket.bucketName })
    new cdk.CfnOutput(this, 'OgImageBucket', { value: ogImageBucket.bucketName })
  }
}
