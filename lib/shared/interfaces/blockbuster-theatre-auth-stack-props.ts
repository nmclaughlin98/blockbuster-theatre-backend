import type * as cdk from 'aws-cdk-lib';

export interface BlockbusterTheatreAuthStackProps extends cdk.StackProps {
    readonly domainPrefix?: string;
    readonly resourceServerIdentifier?: string;
    readonly removalPolicy?: cdk.RemovalPolicy;
}
