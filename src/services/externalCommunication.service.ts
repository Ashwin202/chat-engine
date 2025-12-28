import runQuery from '../database/runQuery';
import { MultiTenantConversationService } from './multiTenantConversation.service';
import { MultiTenantUserService } from './multiTenantUser.service';
import { TenantService } from './tenant.service';
import logger from '../config/logger';

export interface ExternalVisitor {
  id: string;
  tenant_id: string;
  name: string;
  email?: string;
  phone?: string;
  session_id: string;
  ip_address?: string;
  user_agent?: string;
  referrer_url?: string;
  created_at: Date;
  last_activity: Date;
  status: 'active' | 'waiting' | 'assigned' | 'ended';
}

export interface ChatWorkflowConfig {
  id: string;
  tenant_id: string;
  name: string;
  triggers: {
    business_hours?: boolean;
    visitor_location?: string[];
    page_url_contains?: string[];
    visitor_type?: 'new' | 'returning' | 'premium';
  };
  actions: {
    auto_assign?: boolean;
    assignment_type?: 'round_robin' | 'least_active' | 'skill_based';
    welcome_message?: string;
    queue_message?: string;
    offline_message?: string;
    max_wait_time?: number; // minutes
  };
  is_active: boolean;
  priority: number; // Higher number = higher priority
  created_at: Date;
}

export interface ExternalConversation {
  id: string;
  tenant_id: string;
  visitor_id: string;
  assigned_agent_id?: string;
  workflow_id?: string;
  status: 'waiting' | 'active' | 'ended' | 'transferred';
  queue_position?: number;
  wait_time_seconds: number;
  satisfaction_rating?: number;
  created_at: Date;
  assigned_at?: Date;
  ended_at?: Date;
}

export class ExternalCommunicationService {
  // Initialize external visitor session - TENANT BARRIER
  static async initializeVisitorSession(
    tenantId: string,
    visitorData: {
      name: string;
      email?: string;
      phone?: string;
      sessionId: string;
      ipAddress?: string;
      userAgent?: string;
      referrerUrl?: string;
    }
  ): Promise<ExternalVisitor> {
    // Verify tenant exists and is active
    const tenant = await TenantService.getTenantById(tenantId);
    if (!tenant || !tenant.is_active) {
      throw new Error('Tenant not found or inactive');
    }

    const query = `
      INSERT INTO external_visitors 
      (id, tenant_id, name, email, phone, session_id, ip_address, user_agent, referrer_url, status)
      VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `;

    await runQuery(query, [
      tenantId,
      visitorData.name,
      visitorData.email || null,
      visitorData.phone || null,
      visitorData.sessionId,
      visitorData.ipAddress || null,
      visitorData.userAgent || null,
      visitorData.referrerUrl || null
    ]);

    // Get the created visitor - TENANT BARRIER
    const selectQuery = `
      SELECT * FROM external_visitors 
      WHERE tenant_id = ? AND session_id = ?
      ORDER BY created_at DESC LIMIT 1
    `;
    const result = await runQuery(selectQuery, [tenantId, visitorData.sessionId]);
    const visitor = (result.rows as ExternalVisitor[])[0];
    
    if (!visitor) {
      throw new Error('Failed to create visitor session');
    }

    logger.info(`External visitor session initialized: ${visitor.id} for tenant: ${tenantId}`);
    return visitor;
  }

  // Start external conversation with workflow processing - TENANT BARRIER
  static async startExternalConversation(
    tenantId: string,
    visitorId: string,
    initialMessage?: string
  ): Promise<{
    conversation: ExternalConversation;
    assignedAgent?: any;
    welcomeMessage?: string;
    queuePosition?: number;
  }> {
    // Get visitor details - TENANT BARRIER
    const visitor = await this.getVisitorById(tenantId, visitorId);
    if (!visitor) {
      throw new Error('Visitor not found');
    }

    // Find applicable workflow - TENANT BARRIER
    const workflow = await this.getApplicableWorkflow(tenantId, visitor);

    // Create external conversation - TENANT BARRIER
    const conversationId = await this.createExternalConversation(tenantId, visitorId, workflow?.id);

    let assignedAgent = null;
    let queuePosition = null;
    let welcomeMessage = workflow?.actions.welcome_message;

    // Process workflow actions
    if (workflow) {
      if (workflow.actions.auto_assign) {
        assignedAgent = await this.assignAgentToConversation(
          tenantId,
          conversationId,
          workflow.actions.assignment_type || 'round_robin'
        );
      }

      if (!assignedAgent) {
        queuePosition = await this.addToQueue(tenantId, conversationId);
        welcomeMessage = workflow.actions.queue_message || welcomeMessage;
      }
    }

    // Send initial message if provided
    if (initialMessage && assignedAgent) {
      const internalConversation = await MultiTenantConversationService.findOrCreateConversation(
        tenantId,
        `visitor_${visitorId}`, // Virtual user ID for visitor
        assignedAgent.id
      );

      await MultiTenantConversationService.sendMessage(
        tenantId,
        internalConversation.id,
        `visitor_${visitorId}`,
        initialMessage
      );
    }

    const conversation = await this.getExternalConversationById(tenantId, conversationId);
    if (!conversation) {
      throw new Error('Failed to create external conversation');
    }

    const result: {
      conversation: ExternalConversation;
      assignedAgent?: any;
      welcomeMessage?: string;
      queuePosition?: number;
    } = { conversation };

    if (assignedAgent) result.assignedAgent = assignedAgent;
    if (welcomeMessage) result.welcomeMessage = welcomeMessage;
    if (queuePosition) result.queuePosition = queuePosition;

    return result;
  }

  // Get applicable workflow for visitor - TENANT BARRIER
  private static async getApplicableWorkflow(
    tenantId: string,
    visitor: ExternalVisitor
  ): Promise<ChatWorkflowConfig | null> {
    const query = `
      SELECT * FROM chat_workflows 
      WHERE tenant_id = ? AND is_active = TRUE
      ORDER BY priority DESC, created_at ASC
    `;
    
    const result = await runQuery(query, [tenantId]);
    const workflows = result.rows as ChatWorkflowConfig[];

    // Simple workflow matching (can be extended with more complex logic)
    for (const workflow of workflows) {
      // Check business hours
      if (workflow.triggers.business_hours) {
        const now = new Date();
        const hour = now.getHours();
        if (hour < 9 || hour > 17) { // Simple 9-5 check
          continue;
        }
      }

      // Check page URL
      if (workflow.triggers.page_url_contains && visitor.referrer_url) {
        const matches = workflow.triggers.page_url_contains.some(url => 
          visitor.referrer_url!.includes(url)
        );
        if (!matches) continue;
      }

      // First matching workflow wins
      return workflow;
    }

    return null;
  }

  // Create external conversation record - TENANT BARRIER
  private static async createExternalConversation(
    tenantId: string,
    visitorId: string,
    workflowId?: string
  ): Promise<string> {
    const query = `
      INSERT INTO external_conversations 
      (id, tenant_id, visitor_id, workflow_id, status, wait_time_seconds)
      VALUES (UUID(), ?, ?, ?, 'waiting', 0)
    `;

    await runQuery(query, [tenantId, visitorId, workflowId || null]);

    const selectQuery = `
      SELECT id FROM external_conversations 
      WHERE tenant_id = ? AND visitor_id = ?
      ORDER BY created_at DESC LIMIT 1
    `;
    const result = await runQuery(selectQuery, [tenantId, visitorId]);
    return (result.rows as any[])[0]?.id;
  }

  // Assign agent to conversation - TENANT BARRIER
  private static async assignAgentToConversation(
    tenantId: string,
    conversationId: string,
    assignmentType: string
  ): Promise<any | null> {
    let agent = null;

    switch (assignmentType) {
      case 'round_robin':
        agent = await this.getNextRoundRobinAgent(tenantId);
        break;
      case 'least_active':
        agent = await this.getLeastActiveAgent(tenantId);
        break;
      case 'skill_based':
        agent = await this.getSkillBasedAgent(tenantId);
        break;
    }

    if (agent) {
      const updateQuery = `
        UPDATE external_conversations 
        SET assigned_agent_id = ?, status = 'active', assigned_at = NOW()
        WHERE tenant_id = ? AND id = ?
      `;
      await runQuery(updateQuery, [agent.id, tenantId, conversationId]);
    }

    return agent;
  }

  // Get next agent using round-robin - TENANT BARRIER
  private static async getNextRoundRobinAgent(tenantId: string): Promise<any | null> {
    const query = `
      SELECT u.* FROM users u
      WHERE u.tenant_id = ? AND u.is_online = TRUE
      ORDER BY (
        SELECT COALESCE(MAX(ec.assigned_at), '2000-01-01') 
        FROM external_conversations ec 
        WHERE ec.tenant_id = ? AND ec.assigned_agent_id = u.id
      ) ASC
      LIMIT 1
    `;
    
    const result = await runQuery(query, [tenantId, tenantId]);
    return (result.rows as any[])[0] || null;
  }

  // Get least active agent - TENANT BARRIER
  private static async getLeastActiveAgent(tenantId: string): Promise<any | null> {
    const query = `
      SELECT u.*, 
        COALESCE(active_chats.count, 0) as active_chat_count
      FROM users u
      LEFT JOIN (
        SELECT assigned_agent_id, COUNT(*) as count
        FROM external_conversations 
        WHERE tenant_id = ? AND status = 'active'
        GROUP BY assigned_agent_id
      ) active_chats ON u.id = active_chats.assigned_agent_id
      WHERE u.tenant_id = ? AND u.is_online = TRUE
      ORDER BY active_chat_count ASC, u.last_seen DESC
      LIMIT 1
    `;
    
    const result = await runQuery(query, [tenantId, tenantId]);
    return (result.rows as any[])[0] || null;
  }

  // Get skill-based agent (placeholder for future implementation) - TENANT BARRIER
  private static async getSkillBasedAgent(tenantId: string): Promise<any | null> {
    // For now, fallback to least active
    return await this.getLeastActiveAgent(tenantId);
  }

  // Add conversation to queue - TENANT BARRIER
  private static async addToQueue(tenantId: string, conversationId: string): Promise<number> {
    const countQuery = `
      SELECT COUNT(*) as count FROM external_conversations 
      WHERE tenant_id = ? AND status = 'waiting'
    `;
    
    const result = await runQuery(countQuery, [tenantId]);
    const queuePosition = parseInt((result.rows as any[])[0]?.count || '0') + 1;

    const updateQuery = `
      UPDATE external_conversations 
      SET queue_position = ?
      WHERE tenant_id = ? AND id = ?
    `;
    await runQuery(updateQuery, [queuePosition, tenantId, conversationId]);

    return queuePosition;
  }

  // Get visitor by ID - TENANT BARRIER
  static async getVisitorById(tenantId: string, visitorId: string): Promise<ExternalVisitor | null> {
    const query = 'SELECT * FROM external_visitors WHERE tenant_id = ? AND id = ?';
    const result = await runQuery(query, [tenantId, visitorId]);
    return (result.rows as ExternalVisitor[])[0] || null;
  }

  // Get external conversation by ID - TENANT BARRIER
  static async getExternalConversationById(tenantId: string, conversationId: string): Promise<ExternalConversation | null> {
    const query = 'SELECT * FROM external_conversations WHERE tenant_id = ? AND id = ?';
    const result = await runQuery(query, [tenantId, conversationId]);
    return (result.rows as ExternalConversation[])[0] || null;
  }

  // Update visitor activity - TENANT BARRIER
  static async updateVisitorActivity(tenantId: string, visitorId: string): Promise<void> {
    const query = `
      UPDATE external_visitors 
      SET last_activity = NOW() 
      WHERE tenant_id = ? AND id = ?
    `;
    await runQuery(query, [tenantId, visitorId]);
  }

  // End external conversation - TENANT BARRIER
  static async endExternalConversation(
    tenantId: string,
    conversationId: string,
    satisfactionRating?: number
  ): Promise<void> {
    const query = `
      UPDATE external_conversations 
      SET status = 'ended', ended_at = NOW(), satisfaction_rating = ?
      WHERE tenant_id = ? AND id = ?
    `;
    await runQuery(query, [satisfactionRating || null, tenantId, conversationId]);
  }

  // Get tenant external chat statistics
  static async getTenantExternalStats(tenantId: string): Promise<{
    totalVisitors: number;
    activeConversations: number;
    queueLength: number;
    averageWaitTime: number;
    averageSatisfaction: number;
  }> {
    const visitorsQuery = `
      SELECT COUNT(*) as count FROM external_visitors 
      WHERE tenant_id = ? AND DATE(created_at) = CURDATE()
    `;
    
    const activeQuery = `
      SELECT COUNT(*) as count FROM external_conversations 
      WHERE tenant_id = ? AND status = 'active'
    `;
    
    const queueQuery = `
      SELECT COUNT(*) as count FROM external_conversations 
      WHERE tenant_id = ? AND status = 'waiting'
    `;
    
    const waitTimeQuery = `
      SELECT AVG(wait_time_seconds) as avg_wait FROM external_conversations 
      WHERE tenant_id = ? AND assigned_at IS NOT NULL 
      AND DATE(created_at) = CURDATE()
    `;
    
    const satisfactionQuery = `
      SELECT AVG(satisfaction_rating) as avg_rating FROM external_conversations 
      WHERE tenant_id = ? AND satisfaction_rating IS NOT NULL 
      AND DATE(ended_at) = CURDATE()
    `;

    const [visitorsResult, activeResult, queueResult, waitTimeResult, satisfactionResult] = await Promise.all([
      runQuery(visitorsQuery, [tenantId]),
      runQuery(activeQuery, [tenantId]),
      runQuery(queueQuery, [tenantId]),
      runQuery(waitTimeQuery, [tenantId]),
      runQuery(satisfactionQuery, [tenantId])
    ]);

    return {
      totalVisitors: parseInt((visitorsResult.rows as any[])[0]?.count || '0'),
      activeConversations: parseInt((activeResult.rows as any[])[0]?.count || '0'),
      queueLength: parseInt((queueResult.rows as any[])[0]?.count || '0'),
      averageWaitTime: parseFloat((waitTimeResult.rows as any[])[0]?.avg_wait || '0'),
      averageSatisfaction: parseFloat((satisfactionResult.rows as any[])[0]?.avg_rating || '0')
    };
  }
}
