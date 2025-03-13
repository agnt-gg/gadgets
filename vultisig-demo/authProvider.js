// this file determines the OAuth flow for the Vultisig tool

import axios from 'axios';
import BaseProvider from './BaseProvider.js';

export default class VultisigProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.id = 'vultisig';
    this.baseUrl = 'https://api.vultisig.com';
  }

  getAuthorizationUrl(state) {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scope,
      state: `vultisig:${state}`
    });

    return `${this.baseUrl}/oauth/authorize?${params.toString()}`;
  }

  async exchangeCodeForTokens(code) {
    try {
      const response = await axios.post(`${this.baseUrl}/oauth/token`, {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code: code,
        redirect_uri: this.config.redirectUri,
        grant_type: 'authorization_code'
      });

      const expiresAt = Date.now() + (response.data.expires_in * 1000);

      return {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        expires_at: expiresAt
      };
    } catch (error) {
      console.error('Error exchanging code for tokens:', error);
      throw new Error('Failed to exchange code for Vultisig tokens');
    }
  }

  async refreshTokens(refreshToken) {
    try {
      const response = await axios.post(`${this.baseUrl}/oauth/token`, {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      });

      const expiresAt = Date.now() + (response.data.expires_in * 1000);

      return {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token || refreshToken,
        expires_at: expiresAt
      };
    } catch (error) {
      console.error('Error refreshing tokens:', error);
      throw new Error('Failed to refresh Vultisig tokens');
    }
  }
}