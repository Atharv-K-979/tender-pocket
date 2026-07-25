package com.tenderpocket.controllers;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.tenderpocket.config.JwtUtil;
import com.tenderpocket.models.ActivityLog;
import com.tenderpocket.models.Tender;
import com.tenderpocket.models.User;
import com.tenderpocket.repositories.ActivityLogRepository;
import com.tenderpocket.repositories.TenderRepository;
import com.tenderpocket.repositories.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.text.SimpleDateFormat;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private TenderRepository tenderRepository;

    @Autowired
    private ActivityLogRepository activityLogRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private JwtUtil jwtUtil;

    private final ObjectMapper mapper = new ObjectMapper();

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody Map<String, String> body) {
        String username = body.get("username");
        String password = body.get("password");

        if (username == null || password == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Username and password required"));
        }

        // Auto-seed primary accounts if missing
        if (!userRepository.existsById("admin")) {
            userRepository.save(new User("admin", passwordEncoder.encode("admin123"), "Admin", "admin@company.com"));
        }
        if (!userRepository.existsById("misteam")) {
            userRepository.save(new User("misteam", passwordEncoder.encode("misteam123"), "MIS Team", "misteam@company.com"));
        }
        if (!userRepository.existsById("misexec1")) {
            userRepository.save(new User("misexec1", passwordEncoder.encode("misexec123"), "MIS Executive", "misexec1@company.com"));
        }
        if (!userRepository.existsById("specteam")) {
            userRepository.save(new User("specteam", passwordEncoder.encode("specteam123"), "Specification Team", "specteam@company.com"));
        }

        Optional<User> opt = userRepository.findById(username);
        if (opt.isPresent() && passwordEncoder.matches(password, opt.get().getPasswordHash())) {
            User user = opt.get();
            String token = jwtUtil.generateToken(user.getUsername(), user.getRole());
            
            Map<String, Object> resp = new HashMap<>();
            resp.put("success", true);
            resp.put("token", token);
            resp.put("user", Map.of("username", user.getUsername(), "role", user.getRole()));
            return ResponseEntity.ok(resp);
        }

        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("success", false, "error", "Invalid username or password"));
    }

    @GetMapping("/users")
    public ResponseEntity<?> getUsers(@RequestHeader("x-user-role") String userRole) {
        if (!"Admin".equalsIgnoreCase(userRole) && !"MIS Team".equalsIgnoreCase(userRole) && !"MIS Executive".equalsIgnoreCase(userRole) && !"Specification Team".equalsIgnoreCase(userRole)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("success", false, "error", "Access denied: Admin, MIS Team, MIS Executive, or Specification Team only"));
        }

        List<User> rawUsers = userRepository.findAll();
        List<Map<String, Object>> usersList = new ArrayList<>();

        String todayIST = java.time.ZonedDateTime.now(java.time.ZoneId.of("Asia/Kolkata")).toLocalDate().toString(); // YYYY-MM-DD

        // Bulk load all tenders and group by MIS Executive in memory (1 query instead of N+1)
        List<Tender> allTenders = tenderRepository.findAll();
        Map<String, List<Tender>> tendersByExec = new HashMap<>();
        for (Tender t : allTenders) {
            String exec = t.getMisExecutive();
            if (exec != null && !exec.isEmpty()) {
                tendersByExec.computeIfAbsent(exec, k -> new ArrayList<>()).add(t);
            }
        }

        for (User user : rawUsers) {
            Map<String, Object> uMap = new HashMap<>();
            uMap.put("username", user.getUsername());
            uMap.put("role", user.getRole());

            if ("MIS Executive".equalsIgnoreCase(user.getRole())) {
                List<Tender> tenders = tendersByExec.getOrDefault(user.getUsername(), Collections.emptyList());
                
                int live = 0;
                int inProgress = 0;
                int missed = 0;
                int submitted = 0;
                int won = 0;
                int lost = 0;

                for (Tender t : tenders) {
                    String status = resolveTenderStatus(t, todayIST);
                    switch (status) {
                        case "New": live++; break;
                        case "Participating": inProgress++; break;
                        case "Submitted": submitted++; break;
                        case "Missed Deadline":
                        case "Missed Opportunity":
                        case "Lapsed":
                            missed++;
                            break;
                        case "Won": won++; break;
                        case "Lost": lost++; break;
                    }
                }

                uMap.put("stats", Map.of(
                    "live", live,
                    "inProgress", inProgress,
                    "missed", missed,
                    "submitted", submitted,
                    "won", won,
                    "lost", lost
                ));
            } else {
                uMap.put("stats", null);
            }
            usersList.add(uMap);
        }

        return ResponseEntity.ok(Map.of("success", true, "users", usersList));
    }

    @PostMapping("/users")
    public ResponseEntity<?> createUser(
            @RequestHeader("x-user-role") String adminRole,
            @RequestHeader("x-user-username") String adminUser,
            @RequestBody Map<String, String> body) {

        if (!"Admin".equalsIgnoreCase(adminRole)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("success", false, "error", "Access denied: Admin only"));
        }

        String username = body.get("username");
        String password = body.get("password");
        String role = body.get("role");

        if (username == null || password == null || role == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Username, password, and role are required"));
        }

        username = username.trim();
        if (username.length() < 3 || username.length() > 20) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Username must be between 3 and 20 characters"));
        }

        if (userRepository.existsById(username)) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Username already exists"));
        }

        User newUser = new User(username, passwordEncoder.encode(password), role);
        userRepository.save(newUser);

        // Audit Log
        ActivityLog log = new ActivityLog(
                adminUser, "Admin", "Created User", null,
                new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date()),
                "Created user account: " + username + " with role: " + role
        );
        activityLogRepository.save(log);

        return ResponseEntity.ok(Map.of("success", true, "message", "User created successfully"));
    }

    @DeleteMapping("/users")
    public ResponseEntity<?> deleteUser(
            @RequestHeader("x-user-role") String adminRole,
            @RequestHeader("x-user-username") String adminUser,
            @RequestParam("username") String username) {

        if (!"Admin".equalsIgnoreCase(adminRole)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("success", false, "error", "Access denied: Admin only"));
        }

        if (username == null || "admin".equalsIgnoreCase(username.trim())) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Invalid username or cannot delete admin"));
        }

        Optional<User> opt = userRepository.findById(username);
        if (opt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "User not found"));
        }

        userRepository.deleteById(username);

        // Audit Log
        ActivityLog log = new ActivityLog(
                adminUser, "Admin", "Deleted User", null,
                new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date()),
                "Deleted user account: " + username
        );
        activityLogRepository.save(log);

        return ResponseEntity.ok(Map.of("success", true, "message", "User deleted successfully"));
    }

    @GetMapping("/executives")
    public ResponseEntity<?> getExecutives() {
        List<User> execs = userRepository.findByRole("MIS Executive");
        List<String> result = new ArrayList<>();
        for (User u : execs) {
            result.add(u.getUsername());
        }
        return ResponseEntity.ok(Map.of("success", true, "executives", result));
    }

    @GetMapping("/mis-team")
    public ResponseEntity<?> getMisTeam() {
        List<User> team = userRepository.findByRole("MIS Team");
        List<String> result = new ArrayList<>();
        for (User u : team) {
            result.add(u.getUsername());
        }
        return ResponseEntity.ok(Map.of("success", true, "misTeam", result));
    }

    @GetMapping("/spec-team")
    public ResponseEntity<?> getSpecTeam() {
        List<User> team = userRepository.findByRole("Specification Team");
        List<String> result = new ArrayList<>();
        for (User u : team) {
            result.add(u.getUsername());
        }
        return ResponseEntity.ok(Map.of("success", true, "specTeam", result));
    }

    private String resolveTenderStatus(Tender t, String todayIST) {
        boolean hasPassedDueDate = t.getDueDate() != null && t.getDueDate().split(" ")[0].compareTo(todayIST) < 0;

        if ("Awarded".equalsIgnoreCase(t.getStatus())) return "Won";
        if ("Not Awarded".equalsIgnoreCase(t.getStatus())) return "Lost";
        if ("Filed".equalsIgnoreCase(t.getStatus())) return "Submitted";

        if (hasPassedDueDate) {
            if ("Not Participating".equalsIgnoreCase(t.getStatus())) return "Missed Opportunity";
            if ("Issued".equalsIgnoreCase(t.getStatus()) || "Participating".equalsIgnoreCase(t.getStatus()) || t.getStatus() == null) {
                return "Missed Deadline";
            }
        }

        if ("Not Participating".equalsIgnoreCase(t.getStatus())) return "Not Participating";
        if ("Participating".equalsIgnoreCase(t.getStatus())) return "Participating";

        // Check if lapsed (scraped/published for >3 days without action)
        if (t.getPublishDate() != null && !"N/A".equals(t.getPublishDate())) {
            try {
                LocalDate pub = LocalDate.parse(t.getPublishDate());
                long diff = ChronoUnit.DAYS.between(pub, LocalDate.now());
                if (diff > 3) return "Lapsed";
            } catch (Exception e) {}
        }

        return "New";
    }
}
