package com.tenderpocket.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.io.File;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Value("${file.upload-dir:public/documents}")
    private String uploadDir;

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        File dir = new File(uploadDir);
        String absolutePath = dir.getAbsolutePath();
        if (!absolutePath.endsWith(File.separator)) {
            absolutePath += File.separator;
        }

        // Map /documents/** static file requests to local disk directory on Windows & Mac
        registry.addResourceHandler("/documents/**")
                .addResourceLocations(
                        "file:" + absolutePath,
                        "file:public/documents/",
                        "file:./public/documents/"
                );
    }
}
