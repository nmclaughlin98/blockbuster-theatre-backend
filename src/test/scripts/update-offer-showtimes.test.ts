import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    ScanCommand,
    UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { randomScreenForShowtime } from '../../../src/main/lambda/handlers/utils/showtime-schedule';
import { updateOfferShowtimes } from '../../../scripts/update-offer-showtimes';

const dynamoMock = mockClient(DynamoDBDocumentClient);
const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
        region: 'eu-west-2',
        credentials: {
            accessKeyId: 'test',
            secretAccessKey: 'test',
        },
    })
);

describe('offer showtime migration', () => {
    beforeEach(() => {
        dynamoMock.reset();
        dynamoMock.on(UpdateCommand).resolves({});
    });

    it('previews legacy overrides across all pages without writing', async () => {
        dynamoMock.on(ScanCommand)
            .resolvesOnce({
                Items: [
                    { offerId: 'no-override' },
                    {
                        offerId: 'kids-club',
                        overrideShowtimes: { Tuesday: ['11:00', '19:00'] },
                    },
                ],
                LastEvaluatedKey: { offerId: 'kids-club' },
            })
            .resolves({
                Items: [{
                    offerId: 'already-screened',
                    overrideShowtimes: {
                        Saturday: [{ screen: '2', time: '13:00' }],
                    },
                }],
            });
        const reportUpdate = jest.fn();

        const report = await updateOfferShowtimes(
            client,
            'test-offers',
            false,
            reportUpdate
        );

        expect(report).toEqual({
            recordsScanned: 3,
            offersWithOverrides: 2,
            offersChanged: 1,
        });
        expect(reportUpdate).toHaveBeenCalledWith('kids-club', {
            Tuesday: [
                {
                    screen: randomScreenForShowtime('kids-club:Tuesday:0:11:00'),
                    time: '11:00',
                },
                {
                    screen: randomScreenForShowtime('kids-club:Tuesday:1:19:00'),
                    time: '19:00',
                },
            ],
        });
        expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(2);
        expect(dynamoMock.commandCalls(ScanCommand)[1].args[0].input.ExclusiveStartKey)
            .toEqual({ offerId: 'kids-club' });
        expect(dynamoMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('applies screen assignments without changing override days or times', async () => {
        dynamoMock.on(ScanCommand).resolves({
            Items: [{
                offerId: 'kids-club',
                overrideShowtimes: {
                    Tuesday: ['11:00'],
                    Friday: ['19:00'],
                },
            }],
        });

        const report = await updateOfferShowtimes(client, 'test-offers', true);

        expect(report).toEqual({
            recordsScanned: 1,
            offersWithOverrides: 1,
            offersChanged: 1,
        });
        expect(dynamoMock.commandCalls(UpdateCommand)[0].args[0].input).toMatchObject({
            TableName: 'test-offers',
            Key: { offerId: 'kids-club' },
            UpdateExpression: 'SET #overrideShowtimes = :overrideShowtimes',
            ConditionExpression: 'attribute_exists(#offerId)',
            ExpressionAttributeValues: {
                ':overrideShowtimes': {
                    Tuesday: [{
                        screen: randomScreenForShowtime('kids-club:Tuesday:0:11:00'),
                        time: '11:00',
                    }],
                    Friday: [{
                        screen: randomScreenForShowtime('kids-club:Friday:0:19:00'),
                        time: '19:00',
                    }],
                },
            },
        });
    });

    it('validates all records before applying any updates', async () => {
        dynamoMock.on(ScanCommand).resolves({
            Items: [
                { offerId: 'valid', overrideShowtimes: { Monday: ['11:00'] } },
                { offerId: 'invalid', overrideShowtimes: { Monday: ['25:00'] } },
            ],
        });

        await expect(updateOfferShowtimes(client, 'test-offers', true))
            .rejects.toThrow('Offer invalid has an invalid showtime on Monday.');
        expect(dynamoMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('does not rewrite overrides that already have screen assignments', async () => {
        dynamoMock.on(ScanCommand).resolves({
            Items: [{
                offerId: 'kids-club',
                overrideShowtimes: {
                    Tuesday: [{ screen: '4', time: '11:00' }],
                },
            }],
        });

        const report = await updateOfferShowtimes(client, 'test-offers', true);

        expect(report.offersChanged).toBe(0);
        expect(dynamoMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });
});
