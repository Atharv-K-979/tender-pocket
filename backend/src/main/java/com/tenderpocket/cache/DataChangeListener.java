package com.tenderpocket.cache;

import com.tenderpocket.models.Tender;
import com.tenderpocket.models.TenderApprovalRequest;
import com.tenderpocket.models.User;
import jakarta.persistence.PostPersist;
import jakarta.persistence.PostRemove;
import jakarta.persistence.PostUpdate;

/**
 * JPA entity listener that records committed changes in {@link DataVersion}.
 * Attached with {@code @EntityListeners} to every entity the read caches depend on.
 */
public class DataChangeListener {

    @PostPersist
    @PostUpdate
    @PostRemove
    public void onChange(Object entity) {
        if (entity instanceof User) {
            DataVersion.usersChangedAfterCommit();
        } else {
            DataVersion.tenderDataChangedAfterCommit(entity instanceof Tender || entity instanceof TenderApprovalRequest);
        }
    }
}
