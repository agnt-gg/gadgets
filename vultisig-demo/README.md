# Vultisig Tool Integration

The Vultisig tool enables secure cryptographic operations across multiple parties and chains without any single party having access to the complete private key material.

## Key Features

- **Create Vaults**: Establish secure multi-party vaults for key management
- **Sign Transactions**: Collaboratively sign blockchain transactions
- **Derive Child Keys**: Generate hierarchical deterministic wallet addresses
- **Export Public Keys**: Share public key information without compromising security

## Getting Started

1. **Connect to Vultisig**: Go to Settings -> Connected Services and connect your Vultisig account
2. **Create a Vault**: Use the "createVault" operation with at least one other party
3. **Store Key Data**: Save the returned key data securely for future operations
4. **Perform Operations**: Use the stored key data for signing and other operations


## Adding the Vultisig SDK to Your System

To integrate the Vultisig SDK with these files into your AGNT system, follow these steps:

### 1. Install the Vultisig SDK Package

First, add the Vultisig SDK to your project dependencies:

```bash
npm install @vultisig/mpc-sdk
```

Or if you use yarn:

```bash
yarn add @vultisig/mpc-sdk
```

### 2. Add the Tool Files to Your Codebase

1. **Copy the files to the correct locations**:

   - `toolConfig.json`: Add this to your tool library configuration at `/frontend/src/views/WorkflowDesigner/tools/toolLibrary.json`
   - `toolFunctions.js`: Copy to `/backend/workflow/tools/actions/vultisig-mpc.js`
   - `authProvider.js`: Copy to `/backend/src/oauth/providers/VultisigProvider.js`
   - `authConfig.js`: Update your existing `/backend/src/oauth/AuthManager.js` with these entries

2. **Update your environment variables**:

   Add these to your `.env` file:

   ```
   VULTISIG_CLIENT_ID=your_client_id_here
   VULTISIG_CLIENT_SECRET=your_client_secret_here
   ```

### 3. Register the Tool in Your System

Make sure the tool is registered in your AGNT system:

1. If your system has a tool registration configuration, add "vultisig-mpc" to the list of registered tools
2. Ensure the icon referenced in the config (`key-shield`) is available in your assets folder

### 4. Testing the Integration

1. Restart your AGNT server to load the new tool and authentication provider
2. Go to your settings page and connect to Vultisig through the OAuth flow
3. Create a workflow that uses the Vultisig MPC tool
4. Test a simple operation like "exportPublicKey" to verify the connection works

### 5. Understanding the High-Level Flow

Once integrated:

1. Users authenticate with Vultisig through your AGNT system settings
2. The authentication tokens are securely stored using your system's AuthManager
3. When a workflow uses the Vultisig tool, it:
   - Retrieves the user's Vultisig token
   - Creates an instance of the MPC SDK
   - Performs the requested operation (create vault, sign, etc.)
   - Returns the results to the workflow

The Vultisig SDK abstracts away all the complex cryptographic operations and communication with Vultisig's router endpoint, so you don't have to implement direct API calls.

## Implementation Files

The Vultisig tool integration consists of several files that work together:

### 1. `toolConfig.json`
Defines the tool's interface in the AGNT workflow designer:
- Specifies available operations (createVault, signTransaction, etc.)
- Defines all input parameters and their types
- Describes output data structure
- Controls conditional display of parameters based on selected operation

### 2. `toolFunctions.js`
Implements the core functionality of the tool:
- Extends `BaseAction` class to integrate with the AGNT workflow engine
- Handles parameter validation and preparation
- Interfaces with the Vultisig MPC SDK
- Implements specific operations (createVault, signTransaction, etc.)
- Formats outputs for consistent workflow integration

### 3. `authProvider.js`
Manages OAuth authentication with the Vultisig API:
- Handles authorization URL generation
- Exchanges authorization codes for access tokens
- Refreshes expired tokens automatically
- Secures API communication

### 4. `authConfig.js`
Registers the Vultisig authentication provider with AGNT's AuthManager:
- Configures client credentials and scopes
- Sets up redirect URIs for OAuth flow
- Integrates with the platform's authentication system

## How It All Works Together

1. **Authentication Flow**:
   - The `authConfig.js` registers the Vultisig provider with AGNT
   - Users connect their Vultisig account via OAuth using `authProvider.js`
   - Tokens are securely stored and managed by AGNT's AuthManager

2. **Tool Registration**:
   - `toolConfig.json` defines the tool's appearance and interface in the workflow designer
   - The tool shows up in the action palette for users to drag into their workflows

3. **Execution Process**:
   - When a workflow runs, the `toolFunctions.js` executes the selected operation
   - It retrieves authentication tokens via AuthManager
   - It communicates with the Vultisig API using the proper authentication
   - It processes results and returns them in the format defined in `toolConfig.json`

4. **Multi-Party Coordination**:
   - For operations requiring multiple parties, each party runs their own workflow node
   - Parties coordinate using the same session ID
   - The tool handles secure communication between parties via the Vultisig API

## Multi-Party Workflow

For multi-party operations, all parties must:

1. **Agree on a Session ID**: Use the same session ID across all parties
2. **Designate Roles**: One party must be the "initiator" and others "participants"
3. **List Other Parties**: Each party must correctly list all other participating parties
4. **Complete Together**: All required parties must execute their respective nodes within the timeout period

## Security Considerations

- **Key Data**: The key data returned by operations contains sensitive material and should be stored securely
- **Encryption Key**: Use a strong encryption key and keep it secure
- **Threshold**: Setting a threshold less than the total number of parties allows operations to complete with a subset of parties

## Example: Two-Party Vault Creation

For Party 1 (Initiator):
- Operation: createVault
- Party Role: initiator
- Party ID: party1
- Other Parties: party2
- Session ID: [shared-session-id]

For Party 2 (Participant):
- Operation: createVault
- Party Role: participant
- Party ID: party2
- Other Parties: party1
- Session ID: [same-shared-session-id]

Both parties must execute their respective nodes for the operation to complete successfully.
