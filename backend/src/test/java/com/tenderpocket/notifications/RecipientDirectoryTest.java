package com.tenderpocket.notifications;

import com.tenderpocket.models.User;
import org.junit.jupiter.api.Test;

import java.util.List;

import static com.tenderpocket.notifications.PendingActionKey.*;
import static org.junit.jupiter.api.Assertions.*;

class RecipientDirectoryTest {

    private final RecipientDirectory dir = NotifyTestData.directory();

    @Test
    void teamActionWithoutNamedPersonGoesToEveryTeamMember() {
        RecipientDirectory.Owner owner = dir.resolve(new PendingWork(DECIDE, List.of()));
        assertEquals("team:MIS", owner.ownerKey());
        assertEquals(List.of("mis2", "misteam"), owner.recipients());
        assertNull(owner.note());
    }

    @Test
    void queueAliasesAreTreatedAsTheWholeTeam() {
        RecipientDirectory.Owner owner = dir.resolve(new PendingWork(DOC_VERIFY, List.of("MIS Team", "misteam")));
        assertEquals("team:MIS", owner.ownerKey());
        assertEquals(2, owner.recipients().size());
    }

    @Test
    void namedMemberOfTheRightTeamIsTheOnlyRecipient() {
        RecipientDirectory.Owner owner = dir.resolve(new PendingWork(EMD_APPROVE, List.of("MIS Team", "mis2")));
        assertEquals("user:mis2", owner.ownerKey());
        assertEquals(List.of("mis2"), owner.recipients());
    }

    @Test
    void namedPersonFromAnotherTeamIsIgnored() {
        RecipientDirectory.Owner owner = dir.resolve(new PendingWork(SPEC_REVIEW, List.of("executive")));
        assertEquals("team:CLEARANCE", owner.ownerKey());
        assertEquals(List.of("clearance"), owner.recipients());
    }

    @Test
    void executiveActionGoesToThatExecutive() {
        RecipientDirectory.Owner owner = dir.resolve(new PendingWork(SPEC_PREP, List.of("EXEC2")));
        assertEquals("user:exec2", owner.ownerKey());
        assertEquals(List.of("exec2"), owner.recipients());
    }

    @Test
    void missingExecutiveFallsBackToMisWithANote() {
        RecipientDirectory.Owner owner = dir.resolve(new PendingWork(BID_DOCS, List.of("ghost.exec")));
        assertEquals("user:ghost.exec", owner.ownerKey());
        assertEquals(List.of("mis2", "misteam"), owner.recipients());
        assertTrue(owner.note().contains("ghost.exec"));
    }

    @Test
    void executiveWithoutEmailFallsBackToMisButKeepsOwnership() {
        RecipientDirectory d = new RecipientDirectory(List.of(
                new User("misteam", "x", "MIS Team", "mis@example.com"),
                new User("rahul", "x", "Tender Executive", "")), u -> "");
        RecipientDirectory.Owner owner = d.resolve(new PendingWork(SUBMIT, List.of("rahul")));
        assertEquals("user:rahul", owner.ownerKey());
        assertEquals(List.of("misteam"), owner.recipients());
        assertTrue(owner.note().contains("no email"));
    }

    @Test
    void overrideReplacesStoredAddressAndInvalidOnesAreIgnored() {
        RecipientDirectory d = new RecipientDirectory(List.of(
                new User("misteam", "x", "MIS Team", "old@example.com"),
                new User("tpc", "x", "TPC Team", "not-an-email")),
                u -> u.equals("misteam") ? "new@example.com" : "");
        assertEquals("new@example.com", d.find("MISTEAM").email());
        assertEquals("NOTIFY_RECIPIENTS", d.find("misteam").emailSource());
        assertFalse(d.find("tpc").hasEmail());
    }

    @Test
    void unknownRolesAreNotRecipientsAndAdminComesLast() {
        RecipientDirectory d = new RecipientDirectory(List.of(
                new User("admin", "x", "Admin", "a@example.com"),
                new User("guest", "x", "Viewer", "g@example.com"),
                new User("tpc", "x", "TPC Pricing Team", "t@example.com")), u -> "");
        List<RecipientDirectory.Recipient> all = d.all();
        assertEquals(List.of("tpc", "admin"), all.stream().map(RecipientDirectory.Recipient::username).toList());
    }

    @Test
    void teamWithNoAddressesFallsBackToMisAndIsReported() {
        RecipientDirectory d = new RecipientDirectory(List.of(
                new User("tpc", "x", "TPC Team", ""),
                new User("misteam", "x", "MIS Team", "mis@example.com")), u -> "");
        RecipientDirectory.Owner owner = d.resolve(new PendingWork(TPC_PRICE, List.of()));
        assertEquals("team:TPC", owner.ownerKey());
        assertEquals(List.of("misteam"), owner.recipients());
        assertTrue(owner.note().contains("MIS Team received it"));

        RecipientDirectory none = new RecipientDirectory(List.of(new User("tpc", "x", "TPC Team", "")), u -> "");
        RecipientDirectory.Owner nobody = none.resolve(new PendingWork(TPC_PRICE, List.of()));
        assertTrue(nobody.recipients().isEmpty());
        assertTrue(nobody.note().contains("only Admin"));
    }
}
