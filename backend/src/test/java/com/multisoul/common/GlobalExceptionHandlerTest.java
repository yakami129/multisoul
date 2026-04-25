package com.multisoul.common;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/// GlobalExceptionHandlerTest: verifies that AppException maps to correct HTTP status and JSON error body.
///
/// Execution:
///   1. GET /test/error triggers AppException(404, "NOT_FOUND", "resource missing")
///   2. GlobalExceptionHandler catches it
///   3. Returns JSON { "error": "resource missing", "code": "NOT_FOUND" } with HTTP 404
///
/// Expected:
///   - HTTP status 404
///   - JSON body has "error" field = "resource missing"
///   - JSON body has "code" field = "NOT_FOUND"
@WebMvcTest(controllers = GlobalExceptionHandlerTest.TestController.class)
@Import(GlobalExceptionHandler.class)
class GlobalExceptionHandlerTest {

    @Autowired
    private MockMvc mockMvc;

    @RestController
    static class TestController {
        @GetMapping("/test/error")
        void throwError() {
            throw new AppException(404, "NOT_FOUND", "resource missing");
        }
    }

    @Test
    void appExceptionMapsToCorrectHttpStatusAndBody() throws Exception {
        mockMvc.perform(get("/test/error").accept(MediaType.APPLICATION_JSON))
               .andExpect(status().isNotFound())
               .andExpect(jsonPath("$.error").value("resource missing"))
               .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }
}
