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

### 3. `authProvider.js`???
Manages OAuth??? authentication with the Vultisig API:
- Handles authorization URL generation
- Exchanges authorization codes for access tokens
- Refreshes expired tokens automatically
- Secures API communication

### 4. `authConfig.js`???
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