# Multi-stage Dockerfile for Tender Pocket Java Spring Boot Application

# Stage 1: Build JAR with Maven
FROM maven:3.9-eclipse-temurin-21-alpine AS build
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -B
COPY src ./src
RUN mvn package -DskipTests

# Stage 2: Lightweight Runtime Image
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# Ensure directories for SQLite database and uploaded documents
RUN mkdir -p /app/data /app/public/documents

# Copy built JAR from build stage
COPY --from=build /app/target/tender-pocket-spring-0.0.1-SNAPSHOT.jar app.jar

EXPOSE 8080
ENV PORT=8080

ENTRYPOINT ["java", "-jar", "app.jar"]
