// this config gets added to the remote AuthManager.js file that stores your secret keys

import VultisigProvider from './authProvider.js';

// Add Vultisig config
const configs = {
  // ... existing configs ...
  vultisig: {
    clientId: process.env.VULTISIG_CLIENT_ID,
    clientSecret: process.env.VULTISIG_CLIENT_SECRET,
    redirectUri: `${process.env.FRONTEND_URL}/settings`,
    scope: 'mpc:read mpc:write'
  },
};

class AuthManager {
  registerProviders() {
    // ... existing providers ...
    this._registerProvider(new VultisigProvider(configs.vultisig));
  }
  
  // ... rest of the AuthManager class ...
}