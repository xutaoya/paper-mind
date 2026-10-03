// API Configuration
pref("apiKey", "");
pref("model", "");
pref("maxTokens", 0);
pref("temperature", "0.7");
pref(
  "systemPrompt",
  "You are a helpful research assistant. Help the user understand and analyze academic papers and documents.",
);

// PDF Settings
pref("uploadRawPdfOnFailure", false);
pref("useMineruOnExtractFailure", false);
pref("mineruApiToken", "");
pref("mineruAutoCacheOnImport", false);
pref("useExaWebSearch", false);
pref("exaApiKey", "");

pref("reasoningEffort", "default");

// UI Settings
pref("panelMode", "sidebar");
pref("floatingWindowWidth", 420);
pref("floatingWindowHeight", 600);
pref("chatUIFontScale", 100);
pref("debugContextExportEnabled", false);

// Guide Settings
pref("firstInstalledVersion", "");
pref("guideStatus", 0);

// Context Management Settings
pref("contextMaxRecentPairs", 10);
pref("contextEnableSummary", true);
pref("contextAutoCompactBufferTokens", 13000);
pref("contextAutoCompactWindowTokens", 250000);

// AI Tools Settings
pref("toolPermissionDefaultModes", ""); // 各工具默认权限模式映射（JSON）
pref("webSearchProvider", "auto"); // Web 搜索后端
pref("agentMaxPlanningIterations", 30); // 单个 agent turn 的最大 planning 轮次
pref("quickActions", "");
pref("readingStatsStyleImportFingerprint", "");
