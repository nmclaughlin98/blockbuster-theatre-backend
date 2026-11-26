import type * as cdk from 'aws-cdk-lib';
import type { AuthParameters } from './auth-parameters';
import type { EnvironmentName } from '../environment';

export interface BackendStackProps extends cdk.StackProps {
    readonly envName?: EnvironmentName;
    readonly authParameters?: Partial<AuthParameters>;
    readonly prodUserPoolId?: string;
    readonly prodUserPoolClientId?: string;
    readonly prodPostmanClientId?: string;
    readonly prodAlexaClientId?: string;
}
