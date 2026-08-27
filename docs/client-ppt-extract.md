# Client PPT extract — Abstract (1).pptx

- Slides: 15
- Embedded media: 37


## Slide 1

VISVESVARAYA TECHNOLOGICAL UNIVERSITY, Belagavi-590018

SECAB INSTITUTE OF ENGINEERING AND TECHNOLOGY, VIJAYAPUR-586109

2026-2027

PROJECT WORK – PHASE II PRESENTATION ON PROGRESS REVIEW

“AI-Powered Smart Kitchen Management, Expiry Monitoring and Recipe Recommendation System”

Bachelor of Engineering in Electronics and Communication Engineering

Under the Guidance of

Mrs.Uzma Satteekar

Noorain Kaladgi  (2SA23EC038)

Aimanpari Kaladgi (2SA23EC004)

Nimra Fatima Hattarhikal  (2SA23EC036)

Bibi Khuteja Mulla (2SA23EC014)

**Speaker notes:** 2


## Slide 2

ABSTRACT

This project proposes an AI-powered smart kitchen system to reduce food wastage by monitoring food items and their expiry dates. Using ESP32-CAM, AI/OCR, and manual entry, the system maintains a digital inventory, sends WhatsApp alerts for near-expiry items, and recommends recipes based on available ingredients. The system helps users track, consume, and manage food efficiently, reducing unnecessary wastage..

**Speaker notes:** 3


## Slide 3

INTRODUCTION

Food wastage frequently arises from poor awareness of what is stored at home and when it expires. Users commonly forget items until they are unusable. While recipe apps help find dishes, they rarely prioritise recipes that use near-expiry ingredients. Many smart-kitchen solutions rely on cameras, OCR or special hardware—adding complexity and cost. Our project adopts a simpler path: manual inventory entry, expiry-aware prioritization and recipe recommendation integrated with common communication channels.

Know what food you have → Know what expires first → Decide what to cook.

**Speaker notes:** 5


## Slide 4

PAPER TITLES

YEAR

METHEDOLOGY

AI-Powered Smart Cloud Kitchen with Personalized Recipe Recommendation System

2025

Hybrid recipe recommendation, content-based filtering, collaborative filtering, nutritional similarity, semantic NLP and Mini LM embeddings

Fridge Sense: An AI-Powered Solution for Smart Food Tracking and Recipe Planning

2025

Camera-based food detection, YOLOv8, OCR, inventory tracking, expiry monitoring and recipe recommendation

Food Inventory and Expiry Management: A Four-Layer Cloud-Edge Architecture

2025

Cloud-edge architecture, image recognition, OCR, inventory database, expiry tracking and notifications

An AI-Powered Food Expiry Optimizer and Meal Planner

2026

Computer vision, OCR, expiry-date extraction, virtual pantry, expiry tracking, alerts and meal planning

Eco-Culinary AI: An AI-Powered Assistant for Transforming Leftovers Into Smart Recipes

2026

Computer vision, inventory detection and Retrieval-Augmented Generation (RAG)

LITERATURE

SURVEY

**Speaker notes:** 6


## Slide 5

KEY FINDINGS FROM LITERATURE SURVEY

Inventory Tracking

Monitor available items and quantities

Virtual pantry systems

Expiry Monitoring

Identify expiry dates

Prioritize near-expiry items

Recipe Matching

Align ingredients with recipes

Personalized, semantic recommendations

AI Kitchen Technologies

Computer vision, OCR, NLP, cloud-edge, and IoT integration

The literature demonstrates that combining inventory tracking, expiry monitoring, and recipe recommendation creates a powerful foundation for reducing food waste and improving food utilization.

**Speaker notes:** 7


## Slide 6

GAP ANALYSIS

Existing Research

Identified Gap

Food inventory and expiry tracking

Limited integration between expiry priority and recipe selection

Recipe recommendation systems

Do not consistently prioritize ingredients that need immediate use

Fresh/unpackaged/local foods

Often lack visible expiry—manual entry needed for flexibility

Complex smart-kitchen architectures

Require specialized hardware/software; costly and impractical for student projects

Final research gap: Need for a simple, flexible system combining manual inventory, expiry-priority management, and recipe recommendation with convenient notifications.

**Speaker notes:** 8


## Slide 7

PROBLEM STATEMENT

To develop a user-friendly food management system that allows users to manually maintain their food inventory, monitor expiry information, prioritize items nearing expiry, and recommend suitable recipes using available ingredients, while providing timely notifications through WhatsApp and an optional ESP32-based OLED display.

Users forget stored food items.

Food is wasted when expiry dates are overlooked.

Some items lack clearly available expiry information.

Users need guidance on which ingredients to use first.

Existing solutions can be overly complex for low-cost implementation.

Convenient, timely alerts are required.


## Slide 8

OBJECTIVES

01

Web-based inventory

Develop a website for manual food entry, viewing and recipe display.

02

Manual entry

Allow user input of name, quantity and expiry date per item.

03

Structured storage

Store users, food items, recipes and notifications in MySQL.

04

Expiry classification

Classify items as Fresh, Near Expiry or Expired based on remaining days.

05

Expiry-priority

Prioritise items approaching expiry when ranking recipes.

06

Notifications & IoT

Send alerts via WhatsApp; provide optional ESP32+OLED local display.

07

Low-cost & scalable

Create a simple, extensible system to reduce avoidable food waste.


## Slide 9

METHODOLOGY

1. Image Capture – ESP32-CAM captures food images.

2. AI/OCR Detection – Identifies food and expiry details.

3. Validation – Checks detected information.

4. Manual Entry – Used when detection fails or expiry is unavailable.

5. Digital Inventory – Stores food details in the database.

6. Expiry Monitoring – Calculates remaining days and status.

7. WhatsApp Alert – Notifies users about near-expiry items.

8. Recipe Search – Finds recipes using available ingredients.

9. Ingredient Matching – Matches inventory with recipe ingredients.

10. Expiry-Priority Recommendation – Prioritizes recipes using near-expiry food.

11. Inventory Update – Updates the inventory after consumption.


## Slide 10


## Slide 11

FLOW CHART


## Slide 12

APPLICATION


## Slide 13

ADVANTAGES


## Slide 14


## Slide 15

REFERENCE

[1] “AI-Powered Smart Cloud Kitchen with Personalized Recipe Recommendation System,” Hybrid Recipe Recommendation Architecture Using MiniLM Embeddings and Semantic Ingredient Matching.

[2] “An AI-Powered Food Expiry Optimizer and Meal Planner,” End-to-End Integration of Computer Vision, OCR, Expiry Monitoring, and Meal Planning.

[3] “FridgeSense: An AI-Powered Solution for Smart Food Tracking and Recipe Planning,” YOLOv8-Based Food Detection with OCR-Based Expiry Tracking.

[4] “Food Inventory and Expiry Management: A Four-Layer Cloud-Edge Architecture,” Cloud-Edge Processing Model Using OCR-Based Inventory Management and Notification Dispatch.

[5] “Eco-Culinary AI: An AI-Powered Assistant for Transforming Leftovers Into Smart Recipes,” Computer Vision and Retrieval-Augmented Generation (RAG) for Inventory-Grounded Recipe Recommendation.

