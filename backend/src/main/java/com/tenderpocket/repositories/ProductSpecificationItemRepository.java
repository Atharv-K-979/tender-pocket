package com.tenderpocket.repositories;

import com.tenderpocket.models.ProductSpecificationItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ProductSpecificationItemRepository extends JpaRepository<ProductSpecificationItem, Long> {
    List<ProductSpecificationItem> findByProductModelIdOrderByDisplayOrderAsc(Long productModelId);
    List<ProductSpecificationItem> findByProductModelIdAndIsVerifiedTrueOrderByDisplayOrderAsc(Long productModelId);
    void deleteByProductModelId(Long productModelId);
}
