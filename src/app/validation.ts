import { z } from 'zod';

// Set this before importing routes/forms: even a caught eval capability probe
// raises a securitypolicyviolation under the deployed script-src policy.
z.config({ jitless: true });
