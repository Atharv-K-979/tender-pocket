package com.tenderpocket.repositories;

import com.tenderpocket.models.UserSignature;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface UserSignatureRepository extends JpaRepository<UserSignature, String> {
}
