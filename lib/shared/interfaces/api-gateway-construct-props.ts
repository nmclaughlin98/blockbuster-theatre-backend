import type * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import type { EnvironmentName } from '../environment';

export interface ApiGatewayConstructProps {
    apiDocsFunction: lambda.IFunction;
    addMoviesFunction: lambda.IFunction;
    updateMoviesFunction: lambda.IFunction;
    listMoviesFunction: lambda.IFunction;
    listFeaturedMoviesFunction: lambda.IFunction;
    getMovieFunction: lambda.IFunction;
    exportMoviesFunction: lambda.IFunction;
    listTmdbIdsFunction: lambda.IFunction;
    listFilmSelectionsFunction: lambda.IFunction;
    getTicketPricingFunction: lambda.IFunction;
    validateCheckoutFunction: lambda.IFunction;
    sendBookingConfirmationFunction: lambda.IFunction;
    upsertBookingOffersFunction: lambda.IFunction;
    upsertTicketPricingFunction: lambda.IFunction;
    listMovieCollectionsFunction: lambda.IFunction;
    getMovieCollectionFunction: lambda.IFunction;
    refreshMovieCollectionFunction: lambda.IFunction;
    listBookingsFunction: lambda.IFunction;
    createBookingFunction: lambda.IFunction;
    rescheduleBookingFunction: lambda.IFunction;
    manageShowtimesFunction: lambda.IFunction;
    guestBookedSeatsFunction: lambda.IFunction;
    guestBookingFunction: lambda.IFunction;
    guestConversionFunction: lambda.IFunction;
    downloadTicketFunction: lambda.IFunction;
    jwtAuthorizer: authorizers.HttpJwtAuthorizer;
    envName?: EnvironmentName;
}
