import { randomBytes } from "node:crypto";
import { hostname } from "node:os";

/** Identifies this worker process in leases, so logs show who held what. */
export const WORKER_ID = `${hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`;
