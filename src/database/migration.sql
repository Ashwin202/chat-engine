
CREATE TABLE tenants (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name VARCHAR(255) NOT NULL,
  domain VARCHAR(255) UNIQUE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- Tenant settings
  max_users INT DEFAULT 1000,
  max_conversations_per_user INT DEFAULT 100,
  retention_days INT DEFAULT 365
);

-- Core Users Table with Multi-Tenancy
CREATE TABLE users (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_online BOOLEAN DEFAULT FALSE,
  last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  -- Unique email per tenant (not globally unique)
  UNIQUE(tenant_id, email)
);

-- Refresh Tokens for Auth with Tenancy
CREATE TABLE refresh_tokens (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  tenant_id CHAR(36) NOT NULL,
  token_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_revoked BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  -- Unique token_id per tenant
  UNIQUE(tenant_id, token_id)
);

-- Core Conversations with Tenancy (1-to-1 only for scalability)
CREATE TABLE conversations (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  tenant_id CHAR(36) NOT NULL,
  user1_id CHAR(36) NOT NULL,
  user2_id CHAR(36) NOT NULL,
  state ENUM('open', 'closed') DEFAULT 'open',
  last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE,
  -- Unique conversation per tenant
  UNIQUE(tenant_id, user1_id, user2_id),
  CHECK (user1_id < user2_id)
);

-- Core Messages with Status Tracking and Tenancy
CREATE TABLE messages (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  tenant_id CHAR(36) NOT NULL,
  conversation_id CHAR(36) NOT NULL,
  sender_id CHAR(36) NOT NULL,
  content TEXT NOT NULL,
  message_type ENUM('text', 'image', 'file') DEFAULT 'text',
  status ENUM('sent', 'delivered', 'read') DEFAULT 'sent',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  delivered_at TIMESTAMP NULL,
  read_at TIMESTAMP NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Message Read Receipts with Tenancy (for multi-device sync)
CREATE TABLE message_read_receipts (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  tenant_id CHAR(36) NOT NULL,
  message_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  device_id VARCHAR(255),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(tenant_id, message_id, user_id, device_id)
);

-- Multi-Tenant Optimized Indexes with tenant_id as leading column for query isolation
CREATE INDEX idx_tenants_domain ON tenants(domain);
CREATE INDEX idx_tenants_active ON tenants(is_active);

-- Users indexes - tenant_id first for isolation
CREATE INDEX idx_users_tenant_email ON users(tenant_id, email);
CREATE INDEX idx_users_tenant_online ON users(tenant_id, is_online, last_seen);
CREATE INDEX idx_users_tenant_id ON users(tenant_id, id);

-- Refresh tokens indexes - tenant_id first
CREATE INDEX idx_refresh_tokens_tenant_user ON refresh_tokens(tenant_id, user_id);
CREATE INDEX idx_refresh_tokens_tenant_token ON refresh_tokens(tenant_id, token_id);
CREATE INDEX idx_refresh_tokens_tenant_expires ON refresh_tokens(tenant_id, expires_at, is_revoked);

-- Conversations indexes - tenant_id first
CREATE INDEX idx_conversations_tenant_users ON conversations(tenant_id, user1_id, user2_id);
CREATE INDEX idx_conversations_tenant_last_msg ON conversations(tenant_id, last_message_at DESC);
CREATE INDEX idx_conversations_tenant_user1 ON conversations(tenant_id, user1_id);
CREATE INDEX idx_conversations_tenant_user2 ON conversations(tenant_id, user2_id);

-- Messages indexes - tenant_id first for maximum isolation
CREATE INDEX idx_messages_tenant_conversation ON messages(tenant_id, conversation_id, created_at DESC);
CREATE INDEX idx_messages_tenant_sender ON messages(tenant_id, sender_id, created_at DESC);
CREATE INDEX idx_messages_tenant_status ON messages(tenant_id, status, created_at);
CREATE INDEX idx_messages_tenant_created ON messages(tenant_id, created_at DESC);

-- Message receipts indexes - tenant_id first
CREATE INDEX idx_message_receipts_tenant_user ON message_read_receipts(tenant_id, user_id, read_at DESC);
CREATE INDEX idx_message_receipts_tenant_msg ON message_read_receipts(tenant_id, message_id);

-- Insert default tenant for existing data migration
INSERT INTO tenants (id, name, domain, is_active) 
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Tenant', 'localhost', TRUE);
