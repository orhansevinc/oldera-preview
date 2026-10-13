cmake_minimum_required(VERSION 3.16)
project(ko1298_rules_tests LANGUAGES CXX)

enable_testing()

add_subdirectory(${CMAKE_CURRENT_LIST_DIR}/../../services/ko1298-rules
                 ${CMAKE_CURRENT_BINARY_DIR}/ko1298-rules)

add_executable(ko1298_rules_tests zone_rules_test.cpp)
target_link_libraries(ko1298_rules_tests PRIVATE ko1298_rules)
target_compile_features(ko1298_rules_tests PRIVATE cxx_std_17)

if (MSVC)
    target_compile_options(ko1298_rules_tests PRIVATE /W4 /WX)
else()
    target_compile_options(ko1298_rules_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

add_test(NAME ko1298_rules_tests COMMAND ko1298_rules_tests)
