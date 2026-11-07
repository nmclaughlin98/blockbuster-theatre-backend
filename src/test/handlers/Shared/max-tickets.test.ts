import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { mockClient } from 'aws-sdk-client-mock';
import { getMaxTickets } from '../../../main/lambda/handlers/Shared/max-tickets-service';

const ssmMock = mockClient(SSMClient);
const parameterName = '/blockbuster-theatre/booking-configuration/max-tickets-value';
const originalParameterName = process.env.MAX_TICKETS_PARAMETER_NAME;

describe('maximum ticket configuration', () => {
    beforeEach(() => {
        ssmMock.reset();
        delete process.env.MAX_TICKETS_PARAMETER_NAME;
    });

    afterEach(() => {
        if (originalParameterName === undefined) {
            delete process.env.MAX_TICKETS_PARAMETER_NAME;
        } else {
            process.env.MAX_TICKETS_PARAMETER_NAME = originalParameterName;
        }
        jest.restoreAllMocks();
    });

    it('uses 10 when no parameter name is configured', async () => {
        const info = jest.spyOn(console, 'log').mockImplementation(() => { });
        await expect(getMaxTickets()).resolves.toBe(10);
        expect(ssmMock.calls()).toHaveLength(0);
        expect(JSON.parse(String(info.mock.calls[0][0]))).toMatchObject({
            maxTickets: 10,
            source: 'default',
        });
    });

    it('reads the configured maximum from Parameter Store', async () => {
        process.env.MAX_TICKETS_PARAMETER_NAME = parameterName;
        const info = jest.spyOn(console, 'log').mockImplementation(() => { });
        ssmMock.on(GetParameterCommand, { Name: parameterName }).resolves({
            Parameter: { Value: '12' },
        });

        await expect(getMaxTickets()).resolves.toBe(12);
        expect(ssmMock.calls()).toHaveLength(1);
        expect(JSON.parse(String(info.mock.calls[0][0]))).toMatchObject({
            maxTickets: 12,
            source: 'parameter',
            parameterName,
        });
    });

    it('uses 10 when the configured parameter does not exist', async () => {
        process.env.MAX_TICKETS_PARAMETER_NAME = parameterName;
        const info = jest.spyOn(console, 'log').mockImplementation(() => { });
        ssmMock.on(GetParameterCommand, { Name: parameterName }).rejects(
            Object.assign(new Error('Parameter not found'), { name: 'ParameterNotFound' })
        );
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => { });

        await expect(getMaxTickets()).resolves.toBe(10);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(info.mock.calls[0][0]))).toMatchObject({
            maxTickets: 10,
            source: 'default',
            parameterName,
        });
    });

    it('rejects invalid parameter values', async () => {
        process.env.MAX_TICKETS_PARAMETER_NAME = parameterName;
        ssmMock.on(GetParameterCommand, { Name: parameterName }).resolves({
            Parameter: { Value: 'unlimited' },
        });

        await expect(getMaxTickets()).rejects.toThrow(
            `SSM parameter ${parameterName} must contain a positive integer.`
        );
    });

    it('surfaces Parameter Store errors other than a missing parameter', async () => {
        process.env.MAX_TICKETS_PARAMETER_NAME = parameterName;
        const failure = new Error('SSM unavailable');
        ssmMock.on(GetParameterCommand, { Name: parameterName }).rejects(failure);

        await expect(getMaxTickets()).rejects.toBe(failure);
    });
});
