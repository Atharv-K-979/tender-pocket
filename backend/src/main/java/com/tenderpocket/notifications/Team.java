package com.tenderpocket.notifications;

import com.tenderpocket.config.WorkflowPermissions;

/** The five logins that can receive mail, keyed by the canonical role names in WorkflowPermissions. */
public enum Team {
    MIS("MIS Team", "MIS Team", "#2759bf"),
    EXECUTIVE("Tender Executive", "Executive", "#17744a"),
    CLEARANCE("Clearance Team", "Clearance", "#7445b3"),
    TPC("TPC Pricing Team", "TPC", "#a85a0c"),
    ADMIN("Admin", "Admin", "#46525f");

    private final String canonicalRole;
    private final String label;
    private final String color;

    Team(String canonicalRole, String label, String color) {
        this.canonicalRole = canonicalRole;
        this.label = label;
        this.color = color;
    }

    public String getCanonicalRole() { return canonicalRole; }

    public String getLabel() { return label; }

    /** Text colour used for this team in the mails. */
    public String getColor() { return color; }

    /** Maps a stored role ("MIS Team", "misteam", "TPC Team", ...) to its team, or null when unknown. */
    public static Team fromRole(String role) {
        String canonical = WorkflowPermissions.canonicalRole(role);
        for (Team team : values()) {
            if (team.canonicalRole.equals(canonical)) return team;
        }
        return null;
    }
}
