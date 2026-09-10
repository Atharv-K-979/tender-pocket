package com.tenderpocket.services;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.Map;

@Service
public class AutoUpdateService {

    @Value("${app.version:1.0.0}")
    private String currentVersion;

    @Value("${app.update.github-repo:cavipulvbhandari/tender-pocket-spring-workflow}")
    private String githubRepo;

    private boolean updateAvailable = false;
    private String latestVersion = "";
    private String downloadUrl = "";
    private String releaseNotes = "";
    private boolean updateDownloaded = false;
    private String updateError = null;

    public String getCurrentVersion() {
        return currentVersion;
    }

    public Map<String, Object> getUpdateStatus() {
        Map<String, Object> status = new HashMap<>();
        status.put("current_version", currentVersion);
        status.put("update_available", updateAvailable);
        status.put("latest_version", latestVersion);
        status.put("release_notes", releaseNotes);
        status.put("update_downloaded", updateDownloaded);
        status.put("error", updateError);
        return status;
    }

    // Automatically check for GitHub updates every 1 hour (3600000 ms) and 10s after startup
    @Scheduled(initialDelay = 10000, fixedDelay = 3600000)
    public Map<String, Object> checkAndDownloadUpdates() {
        System.out.println("[AutoUpdate] Checking for incremental application updates on GitHub (" + githubRepo + ")...");
        updateError = null;
        try {
            String apiUrl = "https://api.github.com/repos/" + githubRepo + "/releases/latest";
            HttpURLConnection conn = (HttpURLConnection) new URI(apiUrl).toURL().openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("User-Agent", "TenderPocket-AutoUpdater");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(10000);

            if (conn.getResponseCode() == 200) {
                ObjectMapper mapper = new ObjectMapper();
                JsonNode root = mapper.readTree(conn.getInputStream());

                String tagName = root.path("tag_name").asText("");
                String cleanTag = tagName.replaceAll("[^0-9.]", "");
                String cleanCurrent = currentVersion.replaceAll("[^0-9.]", "");

                releaseNotes = root.path("body").asText("");

                if (isNewerVersion(cleanCurrent, cleanTag)) {
                    updateAvailable = true;
                    latestVersion = tagName;
                    System.out.println("[AutoUpdate] 🎉 New update found: " + tagName + " (Current: " + currentVersion + ")");

                    // Find .jar asset URL
                    JsonNode assets = root.path("assets");
                    for (JsonNode asset : assets) {
                        String name = asset.path("name").asText("");
                        if (name.endsWith(".jar")) {
                            downloadUrl = asset.path("browser_download_url").asText("");
                            break;
                        }
                    }

                    if (!downloadUrl.isEmpty()) {
                        downloadUpdateJar(downloadUrl);
                    }
                } else {
                    updateAvailable = false;
                    latestVersion = currentVersion;
                    System.out.println("[AutoUpdate] Application is up to date (Version: " + currentVersion + ")");
                }
            } else {
                updateError = "GitHub API returned HTTP " + conn.getResponseCode();
            }
        } catch (Exception e) {
            updateError = "Update check failed: " + e.getMessage();
            System.err.println("[AutoUpdate] Check failed: " + e.getMessage());
        }

        return getUpdateStatus();
    }

    private void downloadUpdateJar(String jarUrl) {
        System.out.println("[AutoUpdate] Downloading update binary from: " + jarUrl);
        try {
            HttpURLConnection conn = (HttpURLConnection) new URI(jarUrl).toURL().openConnection();
            conn.setRequestProperty("User-Agent", "TenderPocket-AutoUpdater");
            conn.setInstanceFollowRedirects(true);

            int status = conn.getResponseCode();
            if (status == HttpURLConnection.HTTP_MOVED_TEMP || status == HttpURLConnection.HTTP_MOVED_PERM || status == HttpURLConnection.HTTP_SEE_OTHER) {
                String newUrl = conn.getHeaderField("Location");
                conn = (HttpURLConnection) new URI(newUrl).toURL().openConnection();
                conn.setRequestProperty("User-Agent", "TenderPocket-AutoUpdater");
            }

            try (InputStream in = conn.getInputStream()) {
                Files.copy(in, Paths.get("TenderPocket-update.jar"), StandardCopyOption.REPLACE_EXISTING);
                updateDownloaded = true;
                System.out.println("[AutoUpdate] ✅ Update successfully downloaded to TenderPocket-update.jar!");
            }
        } catch (Exception e) {
            updateError = "Failed to download update JAR: " + e.getMessage();
            System.err.println("[AutoUpdate] Download error: " + e.getMessage());
        }
    }

    public boolean triggerRestartAndApply() {
        if (!updateDownloaded && !Files.exists(Paths.get("TenderPocket-update.jar"))) {
            return false;
        }

        try {
            // Write restart trigger file for launcher scripts
            Files.writeString(Paths.get(".restart_trigger"), "RESTART");
            System.out.println("[AutoUpdate] 🔄 Restart trigger written. Exiting application process in 1.5 seconds...");

            new Thread(() -> {
                try {
                    Thread.sleep(1500);
                    System.exit(0);
                } catch (Exception ignored) {}
            }).start();

            return true;
        } catch (Exception e) {
            System.err.println("[AutoUpdate] Error triggering restart: " + e.getMessage());
            return false;
        }
    }

    private boolean isNewerVersion(String current, String latest) {
        if (latest.isEmpty()) return false;
        String[] currParts = current.split("\\.");
        String[] lateParts = latest.split("\\.");

        int length = Math.max(currParts.length, lateParts.length);
        for (int i = 0; i < length; i++) {
            int curr = i < currParts.length ? Integer.parseInt(currParts[i]) : 0;
            int late = i < lateParts.length ? Integer.parseInt(lateParts[i]) : 0;
            if (late > curr) return true;
            if (late < curr) return false;
        }
        return false;
    }
}
