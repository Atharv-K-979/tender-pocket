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

# Tesseract powers OCR for scanned specification PDFs; without it that extraction path fails.
# python3 and pypdf power scripts/parse-gem-pdf.py, which GeMScraperService shells out to in
# order to read place, state, due date and EMD out of each downloaded GeM bid document.
# Without them that parse throws on every tender and the fields are left null.
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-eng python3 py3-pip \
 && (python3 -m pip install --no-cache-dir --break-system-packages pypdf \
     || python3 -m pip install --no-cache-dir pypdf) \
 && python3 -c "import pypdf; print('pypdf', pypdf.__version__)"

# Ensure directories for SQLite database and uploaded documents
RUN mkdir -p /app/data /app/public/documents

# Copy built JAR from build stage
COPY --from=build /app/target/tender-pocket-spring-0.0.1-SNAPSHOT.jar app.jar

# The GeM bid-document parser. This path must match the relative path passed to
# ProcessBuilder in GeMScraperService.downloadAndParseGemPdf, resolved against WORKDIR.
COPY scripts/parse-gem-pdf.py ./scripts/parse-gem-pdf.py

EXPOSE 8090
ENV SPRING_PORT=8090
ENV PORT=8090

ENTRYPOINT ["java", "-jar", "app.jar"]
