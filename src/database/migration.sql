
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



-- External Communication Tables for Multi-Tenant Chat Engine
-- This migration adds tables for external visitors, chat workflows, and external conversations

-- External Visitors (Website visitors/customers) with Tenancy
CREATE TABLE external_visitors (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(20) NULL,
  session_id VARCHAR(255) NOT NULL,
  ip_address VARCHAR(45) NULL,
  user_agent TEXT NULL,
  referrer_url TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  status ENUM('active', 'waiting', 'assigned', 'ended') DEFAULT 'active',
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE(tenant_id, session_id),
  INDEX idx_external_visitors_tenant (tenant_id),
  INDEX idx_external_visitors_session (tenant_id, session_id),
  INDEX idx_external_visitors_status (tenant_id, status),
  INDEX idx_external_visitors_activity (tenant_id, last_activity)
);

-- Chat Workflows for External Communication with Tenancy
CREATE TABLE chat_workflows (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  triggers JSON NULL, -- Store trigger conditions as JSON
  actions JSON NULL,  -- Store action configurations as JSON
  is_active BOOLEAN DEFAULT TRUE,
  priority INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_chat_workflows_tenant (tenant_id),
  INDEX idx_chat_workflows_active (tenant_id, is_active, priority),
  INDEX idx_chat_workflows_priority (tenant_id, priority DESC)
);

-- External Conversations (Visitor-to-Agent chats) with Tenancy
CREATE TABLE external_conversations (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  tenant_id CHAR(36) NOT NULL,
  visitor_id CHAR(36) NOT NULL,
  assigned_agent_id CHAR(36) NULL,
  workflow_id CHAR(36) NULL,
  status ENUM('waiting', 'active', 'ended', 'transferred') DEFAULT 'waiting',
  queue_position INT NULL,
  wait_time_seconds INT DEFAULT 0,
  satisfaction_rating TINYINT NULL CHECK (satisfaction_rating BETWEEN 1 AND 5),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  assigned_at TIMESTAMP NULL,
  ended_at TIMESTAMP NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (visitor_id) REFERENCES external_visitors(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_agent_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (workflow_id) REFERENCES chat_workflows(id) ON DELETE SET NULL,
  INDEX idx_external_conversations_tenant (tenant_id),
  INDEX idx_external_conversations_visitor (tenant_id, visitor_id),
  INDEX idx_external_conversations_agent (tenant_id, assigned_agent_id),
  INDEX idx_external_conversations_status (tenant_id, status),
  INDEX idx_external_conversations_queue (tenant_id, status, queue_position),
  INDEX idx_external_conversations_created (tenant_id, created_at DESC)
);

-- External Messages (bridging external conversations to internal messages) with Tenancy
CREATE TABLE external_messages (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  tenant_id CHAR(36) NOT NULL,
  external_conversation_id CHAR(36) NOT NULL,
  internal_message_id CHAR(36) NULL, -- Maps to messages table
  sender_type ENUM('visitor', 'agent', 'system') NOT NULL,
  sender_id VARCHAR(255) NOT NULL, -- visitor_id or agent user_id or 'system'
  content TEXT NOT NULL,
  message_type ENUM('text', 'image', 'file', 'system') DEFAULT 'text',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (external_conversation_id) REFERENCES external_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (internal_message_id) REFERENCES messages(id) ON DELETE SET NULL,
  INDEX idx_external_messages_tenant (tenant_id),
  INDEX idx_external_messages_conversation (tenant_id, external_conversation_id, created_at DESC),
  INDEX idx_external_messages_internal (internal_message_id),
  INDEX idx_external_messages_sender (tenant_id, sender_type, sender_id)
);

-- Chat SDK Settings for each tenant (for website integration)
CREATE TABLE chat_sdk_settings (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  tenant_id CHAR(36) NOT NULL,
  domain VARCHAR(255) NOT NULL, -- Allowed domain for CORS
  api_key CHAR(36) NOT NULL DEFAULT (UUID()),
  widget_config JSON NULL, -- UI configuration for chat widget
  branding JSON NULL, -- Colors, logo, etc.
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE(api_key),
  INDEX idx_chat_sdk_tenant (tenant_id),
  INDEX idx_chat_sdk_domain (domain),
  INDEX idx_chat_sdk_api_key (api_key),
  INDEX idx_chat_sdk_active (tenant_id, is_active)
);

-- Agent Skills and Availability for skill-based routing with Tenancy
CREATE TABLE agent_skills (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  tenant_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  skill_name VARCHAR(100) NOT NULL,
  skill_level ENUM('beginner', 'intermediate', 'advanced', 'expert') DEFAULT 'intermediate',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(tenant_id, user_id, skill_name),
  INDEX idx_agent_skills_tenant (tenant_id),
  INDEX idx_agent_skills_user (tenant_id, user_id),
  INDEX idx_agent_skills_skill (tenant_id, skill_name, skill_level),
  INDEX idx_agent_skills_active (tenant_id, is_active)
);

-- Agent Availability Status with Tenancy
CREATE TABLE agent_availability (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  tenant_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  status ENUM('available', 'busy', 'away', 'offline') DEFAULT 'offline',
  max_concurrent_chats INT DEFAULT 3,
  current_chat_count INT DEFAULT 0,
  auto_assign BOOLEAN DEFAULT TRUE,
  last_status_change TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(tenant_id, user_id),
  INDEX idx_agent_availability_tenant (tenant_id),
  INDEX idx_agent_availability_status (tenant_id, status, auto_assign),
  INDEX idx_agent_availability_capacity (tenant_id, status, current_chat_count, max_concurrent_chats)
);

-- Insert default workflow for each existing tenant
INSERT INTO chat_workflows (tenant_id, name, triggers, actions, priority)
SELECT 
  id as tenant_id,
  'Default Workflow' as name,
  '{"business_hours": false}' as triggers,
  '{"auto_assign": true, "assignment_type": "round_robin", "welcome_message": "Hello! How can I help you today?", "queue_message": "Please wait, we will connect you with an agent shortly."}' as actions,
  100 as priority
FROM tenants 
WHERE is_active = TRUE;

-- Insert default SDK settings for each tenant
INSERT INTO chat_sdk_settings (tenant_id, domain, widget_config, branding)
SELECT 
  id as tenant_id,
  'localhost' as domain,
  '{"position": "bottom-right", "theme": "light", "showAvatar": true}' as widget_config,
  '{"primaryColor": "#007bff", "fontFamily": "system-ui"}' as branding
FROM tenants 
WHERE is_active = TRUE;
