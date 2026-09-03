let application;

function startupFailure(error) {
  const issues = Array.isArray(error?.issues) ? error.issues : [];
  const fields = issues
    .map((issue) => (Array.isArray(issue?.path) ? issue.path[0] : undefined))
    .filter((field) => typeof field === "string");

  if (fields.length) {
    return {
      code: "SERVER_CONFIGURATION_INVALID",
      message: `Server configuration needs attention: ${[...new Set(fields)].join(", ")}.`,
    };
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    message.includes("@prisma/client did not initialize") ||
    message.includes("Cannot find module '.prisma/client")
  ) {
    return {
      code: "DATABASE_CLIENT_UNAVAILABLE",
      message: "The database client was not packaged correctly.",
    };
  }
  if (error?.code === "ERR_MODULE_NOT_FOUND") {
    return {
      code: "SERVER_MODULE_MISSING",
      message: "A required server module was not packaged correctly.",
    };
  }
  return {
    code: "API_STARTUP_FAILED",
    message: "FuelLedger could not connect to its server. Please try again shortly.",
  };
}

export default async function handler(request, response) {
  try {
    if (!application) {
      const { createApp } = await import("../apps/api/dist/app.js");
      application = createApp();
    }
    return application(request, response);
  } catch (error) {
    console.error("FuelLedger API failed to start", error);
    const failure = startupFailure(error);
    return response.status(503).json({
      error: failure,
    });
  }
}
