package com.multisoul.common;

import org.springframework.http.HttpStatus;

public class AppException extends RuntimeException {
    private final int status;
    private final String code;

    public AppException(int status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public static AppException notFound(String message) {
        return new AppException(HttpStatus.NOT_FOUND.value(), "NOT_FOUND", message);
    }

    public static AppException conflict(String message) {
        return new AppException(HttpStatus.CONFLICT.value(), "CONFLICT", message);
    }

    public static AppException unauthorized(String message) {
        return new AppException(HttpStatus.UNAUTHORIZED.value(), "UNAUTHORIZED", message);
    }

    public static AppException forbidden(String message) {
        return new AppException(HttpStatus.FORBIDDEN.value(), "FORBIDDEN", message);
    }

    public int getStatus() { return status; }
    public String getCode() { return code; }
}
