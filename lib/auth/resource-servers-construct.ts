import * as cognito from 'aws-cdk-lib/aws-cognito';
import { resourceName, type EnvironmentName } from '../shared';

export function createBookingsResourceServer(
    userPool: cognito.UserPool,
    identifier: string,
    envName: EnvironmentName = 'prod'
): { resourceServer: cognito.UserPoolResourceServer; readBookingsScope: cognito.ResourceServerScope } {
    const readBookingsScope = new cognito.ResourceServerScope({
        scopeName: 'bookings.read',
        scopeDescription: 'Read customer bookings',
    });
    const resourceServer = userPool.addResourceServer(envName === 'prod'
        ? 'BookingsResourceServer'
        : 'DevBookingsResourceServer', {
        identifier,
        userPoolResourceServerName: resourceName('blockbuster-theatre-bookings-resource-server', envName),
        scopes: [readBookingsScope],
    });
    return { resourceServer, readBookingsScope };
}
