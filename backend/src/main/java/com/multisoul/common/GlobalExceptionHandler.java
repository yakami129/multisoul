package com.multisoul.common;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(AppException.class)
    public ResponseEntity<ErrorResponse> handleAppException(AppException ex) {
        log.warn("AppException: status={} code={} message={}", ex.getStatus(), ex.getCode(), ex.getMessage());
        return ResponseEntity
            .status(ex.getStatus())
            .body(new ErrorResponse(ex.getMessage(), ex.getCode()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGenericException(Exception ex) {
        log.error("Unhandled exception", ex);
        return ResponseEntity
            .status(500)
            .body(new ErrorResponse("Internal server error", "INTERNAL_ERROR"));
    }
}
