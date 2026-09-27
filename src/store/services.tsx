import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { createAppScheduler, type NotificationScheduler } from '@/notifications';
import { createLoopService, type LoopService } from '@/services/loopService';
import { newId } from '@/utils/id';

import { notifyChanged } from './changes';
import { useDatabase } from './database';
import { useLanguage } from './language';

interface Services {
  service: LoopService;
  scheduler: NotificationScheduler;
}

const ServicesContext = createContext<Services | null>(null);

/**
 * Wires the database, the OS notification scheduler and the loop service together. The service
 * is recreated when the UI language changes, so its flash messages follow the switch immediately.
 */
export function ServicesProvider({ children }: { children: ReactNode }) {
  const db = useDatabase();
  const { lang } = useLanguage();
  const value = useMemo<Services>(() => {
    const scheduler = createAppScheduler(db);
    return { scheduler, service: createLoopService({ db, scheduler, newId, onChange: notifyChanged, lang }) };
  }, [db, lang]);
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices must be used inside <ServicesProvider>');
  return services;
}

export const useLoopService = (): LoopService => useServices().service;
