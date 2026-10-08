import { systemClock } from './lib/time.js';
import { createAccountService } from './services/accountService.js';
import { createAdminService } from './services/adminService.js';
import { createDescriptionService } from './services/descriptionService.js';
import { createHistoryService } from './services/historyService.js';
import { createMidtransClient } from './services/midtransClient.js';
import { createPaymentService } from './services/paymentService.js';
import { createQuotaService } from './services/quotaService.js';
import { createReportService } from './services/reportService.js';
import { createSettingsService } from './services/settingsService.js';
import { createSubscriptionService } from './services/subscriptionService.js';

/** Merangkai semua service. Dependensi luar (db, AI, Midtrans, jam) dapat diganti saat pengujian. */
export function createServices({ db, config, aiClient, clock = systemClock(), midtrans }) {
  const mt = midtrans ?? createMidtransClient(config.midtrans);
  const subscriptions = createSubscriptionService({ db, config, clock });
  const quota = createQuotaService({ db, config, subscriptions });
  const history = createHistoryService({ db, config, clock });
  const accounts = createAccountService({ db, config, clock, subscriptions, quota });
  const settings = createSettingsService({ db });
  const reports = createReportService({ db, clock, history });
  const payments = createPaymentService({ db, config, clock, subscriptions, midtrans: mt });
  const admin = createAdminService({ db, accounts, subscriptions });
  const descriptions = createDescriptionService({
    aiClient,
    maxImageBytes: config.maxImageBytes,
    quota,
    history,
    subscriptions,
  });

  return { db, config, aiClient, subscriptions, quota, history, accounts, settings, reports, payments, admin, descriptions };
}
