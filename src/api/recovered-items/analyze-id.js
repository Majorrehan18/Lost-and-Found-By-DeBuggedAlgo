// Explicit Vercel function entry point for this nested API route.
// Reuse the shared Express application so existing validation and authorization stay centralized.
import app from "../../server.js";

export default app;
