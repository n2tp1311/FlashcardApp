import { defineRailway, github, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const flashcardappVolume = volume("flashcardapp-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "asia-southeast1-eqsg3a", sizeMB: 5000 });
  const FlashcardApp = service("FlashcardApp", {
    source: github("n2tp1311/FlashcardApp", { branch: "main", checkSuites: false }),
    // The import said RAILPACK, but every deploy builds the Dockerfile; say so rather than
    // rely on Railway noticing the file.
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    // Carried over from railway.toml, which the import dropped. Its restart policy (on
    // failure, 10 retries) is Railway's default: Railway stores it as null, so writing it
    // here leaves a change in every plan that apply never clears.
    deploy: {
      healthcheckPath: "/health",
      healthcheckTimeout: 30,
    },
    replicas: { "asia-southeast1-eqsg3a": 1 },
    networking: { privateNetworkEndpoint: "flashcardapp" },
    volumeMounts: { "/app/data/": flashcardappVolume },
  });

  return project("giving-playfulness", {
    variables: { managed: false },
    resources: [FlashcardApp, flashcardappVolume],
  });
});
