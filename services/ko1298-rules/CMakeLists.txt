cmake_minimum_required(VERSION 3.16)
project(ko1298_rules LANGUAGES CXX)

add_library(ko1298_rules STATIC
    src/zone_rules.cpp
)

target_include_directories(ko1298_rules
    PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_compile_features(ko1298_rules PUBLIC cxx_std_17)

if (MSVC)
    target_compile_options(ko1298_rules PRIVATE /W4 /WX)
else()
    target_compile_options(ko1298_rules PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()
