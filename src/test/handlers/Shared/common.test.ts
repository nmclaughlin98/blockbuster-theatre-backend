import { json } from '../../../main/lambda/handlers/utils/common';

describe('shared JSON responses', () => {
    it.each([
        { statusCode: 200, level: 'INFO' as const, method: 'log' as const },
        { statusCode: 400, level: 'WARN' as const, method: 'warn' as const },
        { statusCode: 500, level: 'ERROR' as const, method: 'error' as const },
    ])('logs a $level response with its status code', ({ statusCode, level, method }) => {
        const logger = jest.spyOn(console, method).mockImplementation(() => { });
        const response = json(statusCode, { message: 'do not include response data' });

        expect(response.statusCode).toBe(statusCode);
        expect(JSON.parse(String(logger.mock.calls[0][0]))).toMatchObject({
            level,
            message: 'API response completed.',
            statusCode,
        });
        expect(String(logger.mock.calls[0][0])).not.toContain('do not include response data');
    });
});
