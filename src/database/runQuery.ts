import { pool } from "../config/database";
import logger from "../config/logger";

const runQuery = async (query: string, params?: any[]) => {
  try {
    const result = await pool.query(query, params);
    return result;
  } catch (error: Error | any) {
    logger.error(`Database query error: ${error || error.message}`);
    throw error;
  }
};

export default runQuery;
