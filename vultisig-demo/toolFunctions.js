// this file is the main tool file that is used to execute the Vultisig MPC operations
// this assumes using a remote API endpoint for the Vultisig MPC operations

import BaseAction from "./BaseAction.js";
import axios from "axios";
import crypto from "crypto";
import AuthManager from "../../oauth/AuthManager.js";

// Import Vultisig SDK
import { MPC, KeygenType, SignType } from "@vultisig/mpc-sdk";

class VultisigMPC extends BaseAction {
  constructor() {
    super("vultisig-mpc");
    this.baseUrl = "https://api.vultisig.com";
    this.routerEndpoint = `${this.baseUrl}/router`;
  }

  async execute(params, inputData, workflowEngine) {
    try {
      this.validateParams(params);
      
      // Get API key - either from params or from OAuth
      let apiKey = params.apiKey;
      if (!apiKey) {
        apiKey = await AuthManager.getValidAccessToken(
          workflowEngine.userId,
          "vultisig"
        );
        
        if (!apiKey) {
          throw new Error("No Vultisig API key provided. Please connect to Vultisig in settings or provide an API key.");
        }
      }
      
      // Parse and prepare parameters
      const operation = params.operation;
      const isInitiator = params.partyRole === "initiator";
      const partyId = params.partyId || `party-${crypto.randomUUID().substring(0, 8)}`;
      const otherParties = params.otherParties ? params.otherParties.split(',').map(id => id.trim()) : [];
      const committee = [partyId, ...otherParties];
      const sessionId = params.sessionId || crypto.randomUUID();
      
      // Generate or use provided encryption key
      const encryptionKey = params.encryptionKey || crypto.randomBytes(32).toString('hex');
      
      // Set timeout in milliseconds
      const timeout = (params.timeoutSeconds || 180) * 1000;
      
      console.log(`[Vultisig] Starting operation: ${operation} with sessionId: ${sessionId}`);
      console.log(`[Vultisig] Party ID: ${partyId}, Role: ${params.partyRole}`);
      
      // Parse key data if provided
      let keyData = null;
      if (params.keyData) {
        try {
          keyData = JSON.parse(params.keyData);
        } catch (e) {
          throw new Error("Invalid key data JSON format");
        }
      }
      
      // Configure API client with authentication
      axios.defaults.headers.common["Authorization"] = `Bearer ${apiKey}`;
      
      // Execute the requested operation
      switch (operation) {
        case "createVault":
          return await this.createVault(
            isInitiator,
            partyId,
            committee,
            sessionId,
            encryptionKey,
            params.threshold || committee.length,
            timeout
          );
        
        case "signTransaction":
          if (!keyData) throw new Error("Key data is required for signing");
          if (!params.transactionData) throw new Error("Transaction data is required for signing");
          
          return await this.signTransaction(
            isInitiator,
            partyId,
            committee,
            sessionId,
            encryptionKey,
            keyData,
            params.transactionData,
            timeout
          );
          
        case "deriveChildKey":
          if (!keyData) throw new Error("Key data is required for key derivation");
          if (!params.derivationPath) throw new Error("Derivation path is required");
          
          return await this.deriveChildKey(
            isInitiator,
            partyId,
            committee,
            sessionId,
            encryptionKey,
            keyData,
            params.derivationPath,
            timeout
          );
          
        case "exportPublicKey":
          if (!keyData) throw new Error("Key data is required for exporting public key");
          
          return await this.exportPublicKey(
            keyData,
            params.derivationPath
          );
          
        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }
    } catch (error) {
      console.error("Vultisig MPC error:", error);
      
      // Provide detailed error information
      const errorDetails = error.response?.data?.error || error.message || "Unknown error";
      return this.formatOutput({
        success: false,
        operation: params.operation,
        error: `${errorDetails}`,
        sessionId: params.sessionId
      });
    }
  }

  async createVault(isInitiator, partyId, committee, sessionId, encryptionKey, threshold, timeout) {
    console.log(`[${partyId}] Starting vault creation with ${committee.length} parties (threshold: ${threshold})...`);
    
    // Initialize MPC client
    const mpc = new MPC(
      KeygenType.Keygen,
      isInitiator,
      this.routerEndpoint,
      sessionId,
      partyId,
      committee,
      [], // Empty array for new keygen
      encryptionKey,
      { timeout, threshold }
    );
    
    // Start the keygen process with timeout
    const result = await Promise.race([
      mpc.startKeygen(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Keygen operation timed out")), timeout)
      )
    ]);
    
    console.log(`[${partyId}] Vault creation completed successfully`);
    
    // Create key data to be saved for future operations
    const keyData = {
      partyId,
      committee,
      threshold,
      dkls: result.dkls,
      schnorr: result.schnorr,
      sessionId,
      createdAt: new Date().toISOString()
    };
    
    // Derive blockchain address from public key
    const address = this.deriveAddressFromPublicKey(result.dkls.publicKey);
    
    return this.formatOutput({
      success: true,
      operation: "createVault",
      sessionId: sessionId,
      keyData: keyData,
      publicKeys: {
        ecdsa: result.dkls.publicKey,
        chainCode: result.dkls.chaincode,
        eddsa: result.schnorr.publicKey
      },
      address: address
    });
  }

  async signTransaction(isInitiator, partyId, committee, sessionId, encryptionKey, keyData, transactionData, timeout) {
    console.log(`[${partyId}] Starting transaction signing process...`);
    
    // Initialize MPC client for signing
    const mpc = new MPC(
      SignType.Sign,
      isInitiator,
      this.routerEndpoint,
      sessionId,
      partyId,
      committee,
      [keyData.dkls, keyData.schnorr], // Provide key data from previous keygen
      encryptionKey,
      { timeout }
    );
    
    // Convert transaction data to proper format if needed
    const txData = transactionData.startsWith("0x") 
      ? transactionData.slice(2) 
      : transactionData;
    
    // Start the signing process with timeout
    const result = await Promise.race([
      mpc.startSign(txData),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Signing operation timed out")), timeout)
      )
    ]);
    
    console.log(`[${partyId}] Transaction signing completed successfully`);
    
    return this.formatOutput({
      success: true,
      operation: "signTransaction",
      sessionId: sessionId,
      signature: result.signature,
      publicKeys: {
        ecdsa: keyData.dkls.publicKey,
        eddsa: keyData.schnorr.publicKey
      }
    });
  }

  async deriveChildKey(isInitiator, partyId, committee, sessionId, encryptionKey, keyData, derivationPath, timeout) {
    console.log(`[${partyId}] Starting child key derivation for path: ${derivationPath}...`);
    
    // Initialize MPC client for key derivation
    const mpc = new MPC(
      KeygenType.Derive,
      isInitiator,
      this.routerEndpoint,
      sessionId,
      partyId,
      committee,
      [keyData.dkls, keyData.schnorr], // Provide key data from previous keygen
      encryptionKey,
      { timeout, derivationPath }
    );
    
    // Start the derivation process with timeout
    const result = await Promise.race([
      mpc.startDerive(derivationPath),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Key derivation operation timed out")), timeout)
      )
    ]);
    
    console.log(`[${partyId}] Child key derivation completed successfully`);
    
    // Create child key data to be saved for future operations
    const childKeyData = {
      partyId,
      committee,
      threshold: keyData.threshold,
      dkls: result.dkls,
      schnorr: result.schnorr,
      parentKeyData: keyData.sessionId,
      derivationPath,
      sessionId,
      createdAt: new Date().toISOString()
    };
    
    // Derive blockchain address from child public key
    const address = this.deriveAddressFromPublicKey(result.dkls.publicKey);
    
    return this.formatOutput({
      success: true,
      operation: "deriveChildKey",
      sessionId: sessionId,
      keyData: childKeyData,
      publicKeys: {
        ecdsa: result.dkls.publicKey,
        chainCode: result.dkls.chaincode,
        eddsa: result.schnorr.publicKey
      },
      address: address,
      derivationPath: derivationPath
    });
  }

  async exportPublicKey(keyData, derivationPath) {
    console.log(`Exporting public key data${derivationPath ? ` for path: ${derivationPath}` : ''}...`);
    
    // For the base key, we just return the existing public key data
    if (!derivationPath || derivationPath === "m") {
      const address = this.deriveAddressFromPublicKey(keyData.dkls.publicKey);
      
      return this.formatOutput({
        success: true,
        operation: "exportPublicKey",
        publicKeys: {
          ecdsa: keyData.dkls.publicKey,
          chainCode: keyData.dkls.chaincode,
          eddsa: keyData.schnorr.publicKey
        },
        address: address
      });
    }
    
    // For derived keys, we calculate the public key using BIP32 derivation
    // Note: In production, you'd use a proper HD wallet library for this
    console.log(`Calculating derived public key for path: ${derivationPath}...`);
    
    // Mock derived values for this example
    const mockDerivedKey = `derived-${keyData.dkls.publicKey.substring(0, 8)}-${derivationPath.replace(/\//g, '-')}`;
    const mockDerivedAddress = `addr-${mockDerivedKey.substring(0, 16)}`;
    
    return this.formatOutput({
      success: true,
      operation: "exportPublicKey",
      publicKeys: {
        ecdsa: mockDerivedKey,
        chainCode: keyData.dkls.chaincode,
        eddsa: `ed-${mockDerivedKey}`
      },
      address: mockDerivedAddress,
      derivationPath: derivationPath
    });
  }

  // Utility method to derive a blockchain address from a public key
  // In production, you would use the appropriate blockchain library
  deriveAddressFromPublicKey(publicKey) {
    // This is a simplified mock implementation
    // In production, you'd use the appropriate blockchain library
    // (e.g., ethers.js for Ethereum)
    return `0x${publicKey.substring(0, 40)}`;
  }

  validateParams(params) {
    if (!params.operation) {
      throw new Error("Operation is required");
    }
    
    if (!params.partyRole) {
      throw new Error("Party role (initiator or participant) is required");
    }
    
    if (params.operation !== "exportPublicKey") {
      if (!params.otherParties || params.otherParties.trim() === "") {
        throw new Error("At least one other party is required for MPC operations");
      }
    }
    
    if (params.encryptionKey && params.encryptionKey.length !== 64) {
      throw new Error("Encryption key must be 64 hexadecimal characters");
    }
    
    if (params.operation === "signTransaction") {
      if (!params.keyData) {
        throw new Error("Key data is required for signing operations");
      }
      
      if (!params.transactionData) {
        throw new Error("Transaction data is required for signing operations");
      }
    }
    
    if (params.operation === "deriveChildKey") {
      if (!params.keyData) {
        throw new Error("Key data is required for key derivation");
      }
      
      if (!params.derivationPath) {
        throw new Error("Derivation path is required for key derivation");
      }
      
      // Validate derivation path format
      const pathRegex = /^m(\/\d+'?)*$/;
      if (!pathRegex.test(params.derivationPath)) {
        throw new Error("Invalid derivation path format. Expected format: m/44'/0'/0'/0/0");
      }
    }
    
    if (params.operation === "exportPublicKey" && !params.keyData) {
      throw new Error("Key data is required for exporting public keys");
    }
  }
}

export default new VultisigMPC();