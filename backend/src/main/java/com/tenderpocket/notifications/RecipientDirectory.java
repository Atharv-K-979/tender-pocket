package com.tenderpocket.notifications;

import com.tenderpocket.models.User;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.regex.Pattern;

/**
 * The logins that can receive mail, and who owns each pending action.
 *
 * Ownership follows assignment, not email availability, so the pending clock does not reset
 * when an address is added later. Delivery has a fallback: when the owning executive has no
 * login or no address, MIS receives the item instead so it is never left with nobody.
 */
public class RecipientDirectory {

    /** Assignee values that mean "the whole team" rather than a person. */
    private static final Set<String> QUEUE_ALIASES = Set.of(
            "misteam", "mis team", "mis executive", "mis", "mis_team",
            "clearance", "clearance team", "specification team", "specification", "clearance_team",
            "tpc", "tpc team", "tpc pricing team", "tpc pricing", "tpc_team",
            "admin", "system");

    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

    /** A login that may receive mail. */
    public record Recipient(String username, Team team, String email, String emailSource) {
        public boolean hasEmail() { return email != null && !email.isBlank(); }
    }

    /**
     * Who owns an action and who is mailed about it.
     *
     * @param ownerKey   "user:&lt;username&gt;" or "team:&lt;TEAM&gt;"; the pending clock restarts when it changes
     * @param ownerLabel what the mails show in the "waiting on" column
     * @param recipients usernames that receive this item
     * @param note       set when delivery had to fall back, shown in Admin's delivery report
     */
    public record Owner(String ownerKey, Team team, String ownerLabel, List<String> recipients, String note) {}

    private final Map<String, Recipient> byUsername = new LinkedHashMap<>();

    public RecipientDirectory(List<User> users, Function<String, String> emailOverride) {
        List<User> sorted = new ArrayList<>(users == null ? List.of() : users);
        sorted.sort(Comparator.comparing(u -> u.getUsername() == null ? "" : u.getUsername().toLowerCase(Locale.ROOT)));
        for (User user : sorted) {
            if (user == null || user.getUsername() == null || user.getUsername().isBlank()) continue;
            Team team = Team.fromRole(user.getRole());
            if (team == null) continue;
            String override = emailOverride == null ? "" : clean(emailOverride.apply(user.getUsername()));
            String stored = clean(user.getEmail());
            String email;
            String source;
            if (isEmail(override)) {
                email = override;
                source = "NOTIFY_RECIPIENTS";
            } else if (isEmail(stored)) {
                email = stored;
                source = "users.email";
            } else {
                email = "";
                source = "none";
            }
            byUsername.put(key(user.getUsername()), new Recipient(user.getUsername().trim(), team, email, source));
        }
    }

    public static boolean isEmail(String value) {
        return value != null && EMAIL.matcher(value.trim()).matches();
    }

    /** Every login with a known role, team mails first and Admin last. */
    public List<Recipient> all() {
        List<Recipient> list = new ArrayList<>(byUsername.values());
        list.sort(Comparator.comparing((Recipient r) -> r.team().ordinal()).thenComparing(r -> r.username().toLowerCase(Locale.ROOT)));
        return list;
    }

    public Recipient find(String username) {
        return username == null ? null : byUsername.get(key(username));
    }

    public List<Recipient> members(Team team) {
        return all().stream().filter(r -> r.team() == team).toList();
    }

    public Owner resolve(PendingWork work) {
        PendingActionKey action = work.key();
        Team team = action.getOwner();

        if (team == Team.EXECUTIVE) {
            String assigned = work.preferredOwners().isEmpty() ? "" : work.preferredOwners().get(0);
            Recipient exec = find(assigned);
            if (exec != null && exec.hasEmail()) {
                return new Owner("user:" + exec.username(), Team.EXECUTIVE, exec.username(), List.of(exec.username()), null);
            }
            String why = exec == null
                    ? "Executive '" + assigned + "' has no TenderPocket login"
                    : "Executive '" + exec.username() + "' has no email address";
            String ownerKey = exec == null ? "user:" + assigned : "user:" + exec.username();
            return new Owner(ownerKey, Team.EXECUTIVE, assigned + " (sent to MIS)", queue(Team.MIS), why + ", so MIS Team received it");
        }

        for (String candidate : work.preferredOwners()) {
            if (QUEUE_ALIASES.contains(candidate.trim().toLowerCase(Locale.ROOT))) continue;
            Recipient person = find(candidate);
            if (person != null && person.team() == team) {
                if (person.hasEmail()) {
                    return new Owner("user:" + person.username(), team, person.username(), List.of(person.username()), null);
                }
                List<String> fallback = queue(team);
                return new Owner("user:" + person.username(), team, person.username() + " (sent to " + team.getLabel() + ")",
                        fallback, "'" + person.username() + "' has no email address, so " + team.getLabel() + " received it");
            }
        }

        List<String> members = queue(team);
        if (!members.isEmpty()) {
            return new Owner("team:" + team.name(), team, team.getLabel(), members, null);
        }
        if (team != Team.MIS && !queue(Team.MIS).isEmpty()) {
            return new Owner("team:" + team.name(), team, team.getLabel() + " (sent to MIS)", queue(Team.MIS),
                    "No " + team.getLabel() + " login has an email address, so MIS Team received it");
        }
        return new Owner("team:" + team.name(), team, team.getLabel(), List.of(),
                "No " + team.getLabel() + " login has an email address, so only Admin sees it");
    }

    private List<String> queue(Team team) {
        return members(team).stream().filter(Recipient::hasEmail).map(Recipient::username).toList();
    }

    private static String key(String username) {
        return username.trim().toLowerCase(Locale.ROOT);
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
