import { maintainRollingSchedule } from '../../services/showtimes/movie-schedule-service';
import { log } from '../../main/lambda/handlers/utils/common';

export const handler = async (): Promise<void> => {
    try {
        const result = await maintainRollingSchedule({ cleanPast: true });
        log('INFO', 'Maintained rolling screening schedule', result);
    } catch (error: unknown) {
        log('ERROR', 'Failed to maintain rolling screening schedule', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });

        throw error;
    }
};
