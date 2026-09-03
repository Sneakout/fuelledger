let application;

export default async function handler(request, response) {
  try {
    if (!application) {
      const { createApp } = await import("../apps/api/dist/app.js");
      application = createApp();
    }
    return application(request, response);
  } catch (error) {
    console.error("FuelLedger API failed to start", error);
    return response.status(503).json({
      error: {
        code: "API_STARTUP_FAILED",
        message:
          "FuelLedger could not connect to its server. Please try again shortly.",
      },
    });
  }
}
