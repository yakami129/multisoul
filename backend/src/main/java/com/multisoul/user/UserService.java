package com.multisoul.user;

import com.multisoul.common.AppException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserService {

    private final UserRepository userRepository;

    public UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Transactional
    public User createUser(String email) {
        if (userRepository.existsByEmail(email)) {
            throw AppException.conflict("Email already registered: " + email);
        }
        return userRepository.save(new User(email));
    }
}
