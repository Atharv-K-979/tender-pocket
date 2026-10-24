package com.tenderpocket.repositories;

import com.tenderpocket.models.ProductModel;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ProductModelRepository extends JpaRepository<ProductModel, Long> {
    Optional<ProductModel> findByModelNumber(String modelNumber);
    List<ProductModel> findByProductCategoryIgnoreCase(String productCategory);
    List<ProductModel> findByStatus(String status);
    List<ProductModel> findByMakeIgnoreCase(String make);
}
