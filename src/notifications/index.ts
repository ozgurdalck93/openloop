import type { Db } from '@/db/types';

import { expoNotificationsApi } from './expoApi';
import { createScheduler, type NotificationScheduler } from './scheduler';

export { CATEGORY_ACTIONS, CATEGORY_IDS } from './categories';
export { configureNotificationHandler } from './expoApi';
export { planNotification } from './plan';
export type { NotificationScheduler } from './scheduler';

/** The app's scheduler: the real OS behind the tested scheduling logic. */
export const createAppScheduler = (db: Db): NotificationScheduler => createScheduler(db, expoNotificationsApi);
